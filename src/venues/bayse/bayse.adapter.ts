import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import type {
  IVenueAdapter,
  NormalizedMarket,
  NormalizedOrderBook,
  NormalizedQuote,
  NormalizedOrder,
  MarketQueryParams,
  QuoteParams,
  PlaceOrderParams,
  PriceCallback,
  Unsubscribe,
} from '../interfaces/venue-adapter.interface';

interface BayseMarketRaw {
  id: string;
  title: string;
  status: string;
  outcome1Id: string;
  outcome1Label: string;
  outcome1Price: number;
  outcome2Id: string;
  outcome2Label: string;
  outcome2Price: number;
  yesBuyPrice?: number | null;   // actual buy price (includes AMM spread)
  noBuyPrice?: number | null;
  feePercentage?: number | null;
  totalOrders?: number | null;
  rules?: string | null;
}

interface BayseEventRaw {
  id: string;
  slug: string | null;
  title: string | null;
  description: string | null;
  category: string | null;
  type: string | null;
  engine: string | null;           // 'AMM' | 'CLOB' (uppercase from API)
  status: string | null;           // open|closed|resolved|cancelled|paused|draft
  openingDate?: string | null;
  closingDate?: string | null;     // when trading closes
  resolutionDate?: string | null;  // when market resolves
  createdAt?: string | null;
  imageUrl?: string | null;
  image128Url?: string | null;
  liquidity?: number | null;
  totalVolume?: number | null;
  totalOrders?: number | null;
  supportedCurrencies?: string[] | null;
  markets: BayseMarketRaw[] | null;
}

interface BayseEventsResponse {
  events: BayseEventRaw[];
  pagination: {
    page: number;
    size: number;
    lastPage: number;
    totalCount: number;
  };
}

const PAGE_SIZE = 50;
const MAX_MARKETS = 250;

@Injectable()
export class BayseAdapter implements IVenueAdapter {
  readonly venueId = 'bayse';
  private readonly logger = new Logger(BayseAdapter.name);
  private readonly baseUrl: string;

  constructor(
    private readonly http: HttpService,
    config: ConfigService,
  ) {
    this.baseUrl =
      config.get<string>('BAYSE_BASE_URL') ?? 'https://relay.bayse.markets';
  }

  async fetchMarkets(_params?: MarketQueryParams): Promise<NormalizedMarket[]> {
    const results: NormalizedMarket[] = [];
    let page = 1;
    let lastPage = 1;

    do {
      const res = await firstValueFrom(
        this.http.get<BayseEventsResponse>(`${this.baseUrl}/v1/pm/events`, {
          params: { page, size: PAGE_SIZE },
        }),
      );

      const data = res.data;
      const events: BayseEventRaw[] = Array.isArray(data?.events) ? data.events : [];
      lastPage = data?.pagination?.lastPage ?? 1;

      if (page === 1) {
        this.logger.debug(
          `Bayse page 1: ${events.length} events, lastPage=${lastPage}, totalCount=${data?.pagination?.totalCount ?? '?'}`,
        );
      }

      results.push(...events.map((e) => this.normalise(e)));
      page++;

      if (results.length >= MAX_MARKETS) break;
    } while (page <= lastPage);

    const capped = results.slice(0, MAX_MARKETS);
    this.logger.log(`Bayse fetched ${capped.length} events (cap: ${MAX_MARKETS})`);
    return capped;
  }

  async fetchMarket(venueMarketId: string): Promise<NormalizedMarket> {
    const res = await firstValueFrom(
      this.http.get<BayseEventRaw>(
        `${this.baseUrl}/v1/pm/events/${venueMarketId}`,
      ),
    );
    return this.normalise(res.data);
  }

  async fetchOrderBook(venueMarketId: string): Promise<NormalizedOrderBook> {
    const res = await firstValueFrom(
      this.http.get<{ bids: { price: number; size: number }[]; asks: { price: number; size: number }[] }>(
        `${this.baseUrl}/v1/pm/books`,
        { params: { outcomeId: venueMarketId } },
      ),
    );
    return {
      venueMarketId,
      outcome: 'YES',
      bids: res.data.bids,
      asks: res.data.asks,
      timestamp: new Date(),
    };
  }

  async getQuote(_params: QuoteParams): Promise<NormalizedQuote> {
    throw new Error('Bayse getQuote not yet implemented');
  }

  subscribeToPrice(_venueMarketId: string, _cb: PriceCallback): Unsubscribe {
    throw new Error('Bayse subscribeToPrice not yet implemented');
  }

  async placeOrder(_params: PlaceOrderParams): Promise<NormalizedOrder> {
    throw new Error('Bayse placeOrder not yet implemented');
  }

  async cancelOrder(_venueOrderId: string): Promise<void> {
    throw new Error('Bayse cancelOrder not yet implemented');
  }

  async getOrder(_venueOrderId: string): Promise<NormalizedOrder> {
    throw new Error('Bayse getOrder not yet implemented');
  }

  // Response: { markets: [{ priceHistory: [{ e: ms, p: 0-1 }] }] }
  async fetchPriceHistory(
    venueMarketId: string,
    _range: string,
    _opts?: { tokenId?: string },
  ): Promise<import('../interfaces/venue-adapter.interface').PriceHistoryPoint[]> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ markets?: { priceHistory?: { e: number; p: number }[] }[] }>(
          `${this.baseUrl}/v1/pm/events/${venueMarketId}/price-history`,
        ),
      );
      const priceHistory = res.data?.markets?.[0]?.priceHistory ?? [];
      return priceHistory.map((pt) => ({
        time: new Date(pt.e),
        price: pt.p,
      }));
    } catch {
      return [];
    }
  }

  // ─── Normalisation ───────────────────────────────────────────────────────

  private normalise(raw: BayseEventRaw): NormalizedMarket {
    // resolutionDate = when it resolves; closingDate = when trading stops
    const resolutionDate = this.parseDate(raw.resolutionDate ?? raw.closingDate);
    const openDate = this.parseDate(raw.openingDate ?? raw.createdAt);

    const marketUrl = raw.slug
      ? `${this.baseUrl.replace('relay.', '')}/events/${raw.slug}`
      : undefined;

    const markets = raw.markets ?? [];
    const firstMarket = markets[0];

    // Binary: first market has outcome1=YES and outcome2=NO — don't gate on length
    // so we correctly handle events even when Bayse returns extra market entries.
    const isBinary =
      !!firstMarket &&
      firstMarket.outcome1Label?.toLowerCase().trim() === 'yes' &&
      firstMarket.outcome2Label?.toLowerCase().trim() === 'no';

    let outcomes: NormalizedMarket['outcomes'];

    if (isBinary) {
      const m = firstMarket;
      const mUrl = `${this.baseUrl}/v1/pm/events/${raw.id}/markets/${m.id}`;
      outcomes = [
        {
          id: m.outcome1Id,
          label: 'YES',
          price: m.yesBuyPrice ?? m.outcome1Price ?? 0,
          shares: 0,
          marketUrl: mUrl,
        },
        {
          id: m.outcome2Id,
          label: 'NO',
          price: m.noBuyPrice ?? m.outcome2Price ?? 0,
          shares: 0,
          marketUrl: mUrl,
        },
      ];
    } else {
      // Categorical: each sub-market is a separate outcome; use outcome1Label if available
      outcomes = markets.map((m) => ({
        id: m.outcome1Id || m.id,
        label: (m.outcome1Label?.trim() || m.title).toUpperCase(),
        price: m.yesBuyPrice ?? m.outcome1Price ?? 0,
        shares: 0,
        marketUrl: `${this.baseUrl}/v1/pm/events/${raw.id}/markets/${m.id}`,
      }));
    }

    return {
      id: raw.id,
      venueId: this.venueId,
      venueMarketId: raw.id,
      title: raw.title ?? raw.slug ?? raw.id,
      description: raw.description ?? undefined,
      image: raw.imageUrl ?? undefined,
      icon: raw.image128Url ?? raw.imageUrl ?? undefined,
      ticker: raw.slug ?? undefined,
      marketUrl,
      category: raw.category ?? 'general',
      outcomes,
      resolutionDate,
      openDate,
      status: this.normaliseStatus(raw.status),
      engine: raw.engine?.toLowerCase() === 'amm' ? 'amm' : 'clob',
      volume24h: raw.totalVolume ?? 0,
      liquidity: raw.liquidity ?? 0,
      createdAt: openDate ?? new Date(),
    };
  }

  private parseDate(s: string | null | undefined): Date | null {
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  private normaliseStatus(status: string | null): 'open' | 'closed' | 'resolved' {
    switch (status?.toLowerCase()) {
      case 'resolved':
        return 'resolved';
      case 'closed':
      case 'cancelled':
      case 'paused':
      case 'draft':
        return 'closed';
      default:
        return 'open';
    }
  }
}
