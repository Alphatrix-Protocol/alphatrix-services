import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MarketGroup } from '../entities/market-group.entity';
import { Market } from '../entities/market.entity';
import { PolymarketAdapter } from '../../venues/polymarket/polymarket.adapter';
import { BayseAdapter } from '../../venues/bayse/bayse.adapter';
import type { IVenueAdapter } from '../../venues/interfaces/venue-adapter.interface';
import { toCandles, toLine, rangeToBucketMs } from './price-history.utils';

interface FindAllParams {
  category?: string;
  status?: string;
  venueId?: string;
  page: number;
  size: number;
}

@Injectable()
export class AggregationService {
  private readonly adapters: Map<string, IVenueAdapter>;

  constructor(
    @InjectRepository(MarketGroup)
    private readonly marketGroupRepo: Repository<MarketGroup>,
    @InjectRepository(Market)
    private readonly marketRepo: Repository<Market>,
    polymarketAdapter: PolymarketAdapter,
    bayseAdapter: BayseAdapter,
  ) {
    this.adapters = new Map<string, IVenueAdapter>([
      ['polymarket', polymarketAdapter],
      ['bayse', bayseAdapter],
    ]);
  }

  async findAll({ category, status, venueId, page, size }: FindAllParams) {
    if (venueId) {
      return this.findByVenue({ venueId, category, status, page, size });
    }

    const knownVenues = [...this.adapters.keys()];
    const perVenue = Math.ceil(size / knownVenues.length);

    const venuePages = await Promise.all(
      knownVenues.map((v) =>
        this.findByVenue({ venueId: v, category, status, page, size: perVenue }),
      ),
    );

    const interleaved: object[] = [];
    const maxLen = Math.max(...venuePages.map((vp) => vp.data.length));
    for (let i = 0; i < maxLen; i++) {
      for (const vp of venuePages) {
        if (i < vp.data.length) interleaved.push(vp.data[i]);
      }
    }

    const total = venuePages.reduce((sum, vp) => sum + vp.total, 0);
    return { data: interleaved.slice(0, size), total, page, size };
  }

  private async findByVenue({
    venueId,
    category,
    status,
    page,
    size,
  }: Required<Pick<FindAllParams, 'venueId'>> & Omit<FindAllParams, 'venueId'>) {
    const qb = this.marketRepo
      .createQueryBuilder('m')
      .where('m.venueId = :venueId', { venueId });

    if (category) qb.andWhere('m.category = :category', { category });
    if (status) qb.andWhere('m.status = :status', { status });
    else qb.andWhere("m.status = 'open'");

    const [markets, total] = await qb
      .orderBy('m.liquidity', 'DESC')
      .skip((page - 1) * size)
      .take(size)
      .getManyAndCount();

    const data = markets.map((m) => {
      const raw = (m.rawData ?? {}) as { image?: string; icon?: string };
      const { yesPrice, noPrice } = this.extractBinaryPrices(m);
      return {
        id: m.id,
        venueId: m.venueId,
        venueMarketId: m.venueMarketId,
        matchGroupId: m.matchGroupId,
        title: m.title,
        category: m.category,
        engine: m.engine,
        status: m.status,
        volume24h: m.volume24h,
        liquidity: m.liquidity,
        closingDate: m.resolutionDate,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        image: raw.image ?? null,
        icon: raw.icon ?? null,
        yesPrice,
        noPrice,
        change24h: null,
      };
    });

    return { data, total };
  }

  async findOne(id: string) {
    let market = await this.marketRepo.findOne({
      where: [{ id }, { venueMarketId: id }],
    });

    let markets: Market[];
    let title: string;
    let category: string;
    let resolutionDate: Date | null;
    let status: string;

    if (market) {
      markets = market.matchGroupId
        ? await this.marketRepo.find({ where: { matchGroupId: market.matchGroupId } })
        : [market];
      title = market.title;
      category = market.category;
      resolutionDate = market.resolutionDate;
      status = market.status;
    } else {
      const group = await this.marketGroupRepo.findOne({
        where: { id },
        relations: ['markets'],
      });
      if (!group) throw new NotFoundException(`Market ${id} not found`);
      markets = group.markets;
      title = group.canonicalTitle;
      category = group.category;
      resolutionDate = group.resolutionDate;
      status = group.status;
    }

    type RawOutcome = {
      id: string;
      label: string;
      price: number;
      ticker?: string;
      marketUrl?: string;
      volume?: number;
      volume24h?: number;
      openInterest?: number;
      yesMint?: string;
      noMint?: string;
    };

    type RawMarket = {
      description?: string;
      image?: string;
      icon?: string;
      ticker?: string;
      marketUrl?: string;
      openInterest?: number;
      velocity1h?: number;
      outcomes?: RawOutcome[];
    };

    const venues = markets.map((m) => {
      const raw = (m.rawData ?? {}) as RawMarket;
      const outcomes = raw.outcomes ?? [];
      const yes = outcomes.find((o) => o.label.toUpperCase() === 'YES');
      const no = outcomes.find((o) => o.label.toUpperCase() === 'NO');

      return {
        venueId: m.venueId,
        venueMarketId: m.venueMarketId,
        ticker: raw.ticker ?? null,
        marketUrl: raw.marketUrl ?? null,
        yesPrice: Math.round((yes?.price ?? 0) * 100),
        noPrice: Math.round((no?.price ?? 0) * 100),
        openInterest: raw.openInterest ?? null,
        volume24h: m.volume24h,
        liquidity: m.liquidity,
        outcomes: outcomes.map((o) => ({
          id: o.id,
          label: o.label,
          price: Math.round(o.price * 100),
          ticker: o.ticker ?? null,
          marketUrl: o.marketUrl ?? null,
          volume: o.volume ?? null,
          volume24h: o.volume24h ?? null,
          openInterest: o.openInterest ?? null,
          yesMint: o.yesMint ?? null,
          noMint: o.noMint ?? null,
        })),
      };
    });

    const totalVolume = markets.reduce((s, m) => s + m.volume24h, 0);
    const totalLiquidity = markets.reduce((s, m) => s + m.liquidity, 0);
    const bestYesPrice = venues.reduce((max, v) => Math.max(max, v.yesPrice), 0);

    const primaryRaw = (markets[0].rawData ?? {}) as RawMarket;

    return {
      event: {
        id,
        title,
        description: primaryRaw.description ?? null,
        category,
        image: primaryRaw.image ?? null,
        icon: primaryRaw.icon ?? null,
        endDate: resolutionDate?.toISOString() ?? null,
        status,
      },
      brief: {
        volume: totalVolume,
        liquidity: totalLiquidity,
        marketProbability: bestYesPrice,
      },
      venues,
    };
  }

  async findPriceHistory(id: string, range: string) {
    const markets = await this.resolveMarkets(id);
    const bucketMs = rangeToBucketMs(range);

    const venues = await Promise.all(
      markets.map(async (m, idx) => {
        const adapter = this.adapters.get(m.venueId);
        if (!adapter) return null;

        const tokenId = this.extractYesTokenId(m);
        const points = await adapter.fetchPriceHistory(m.venueMarketId, range, { tokenId });

        if (idx === 0) {
          return {
            venueId: m.venueId,
            type: 'candle' as const,
            data: toCandles(points, bucketMs),
          };
        }
        return {
          venueId: m.venueId,
          type: 'line' as const,
          data: toLine(points, bucketMs),
        };
      }),
    );

    return { venues: venues.filter(Boolean) };
  }

  async findTrades(_id: string, _limit: number) {
    // No trade data source yet — returns empty so frontend shows empty state
    return { trades: [] };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async resolveMarkets(id: string): Promise<Market[]> {
    const market = await this.marketRepo.findOne({
      where: [{ id }, { venueMarketId: id }],
    });

    if (market) {
      return market.matchGroupId
        ? this.marketRepo.find({ where: { matchGroupId: market.matchGroupId } })
        : [market];
    }

    const group = await this.marketGroupRepo.findOne({
      where: { id },
      relations: ['markets'],
    });
    if (!group) throw new NotFoundException(`Market ${id} not found`);
    return group.markets;
  }

  private extractYesTokenId(market: Market): string | undefined {
    const raw = market.rawData as { outcomes?: { label: string; yesMint?: string }[] };
    const yes = (raw?.outcomes ?? []).find((o) => o.label?.toUpperCase() === 'YES');
    return yes?.yesMint;
  }

  private extractBinaryPrices(market: Market): { yesPrice: number | null; noPrice: number | null } {
    const raw = market.rawData as { outcomes?: { label: string; price: number }[] };
    const outcomes = raw?.outcomes ?? [];
    const yes = outcomes.find((o) => o.label.toUpperCase() === 'YES');
    const no = outcomes.find((o) => o.label.toUpperCase() === 'NO');
    return {
      yesPrice: yes && yes.price > 0 ? Math.round(yes.price * 100) : null,
      noPrice: no && no.price > 0 ? Math.round(no.price * 100) : null,
    };
  }
}
