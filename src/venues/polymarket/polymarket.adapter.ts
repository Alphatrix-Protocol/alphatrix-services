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

interface PolymarketMarketInEvent {
  id: string;
  conditionId: string;
  question: string;
  description: string | null;
  image: string | null;
  icon: string | null;
  slug: string | null;
  endDate: string | null;
  startDate: string | null;
  active: boolean;
  closed: boolean;
  volume: string | number | null;
  volume24hr: number | null;
  liquidity: string | number | null;
  outcomes: string | null;        // JSON string e.g. '["Yes","No"]'
  outcomePrices: string | null;   // JSON string e.g. '["0.65","0.35"]'
  clobTokenIds: string | null;    // JSON string e.g. '["tokenA","tokenB"]'
  lastTradePrice: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  oneDayPriceChange: number | null;
}

interface PolymarketEventRaw {
  id: string;
  slug: string | null;
  title: string | null;
  description: string | null;
  image: string | null;
  icon: string | null;
  category: string | null;
  active: boolean;
  closed: boolean;
  endDate: string | null;
  startDate: string | null;
  creationDate: string | null;
  volume24hr: number | null;
  volume: number | null;
  liquidity: number | null;
  markets: PolymarketMarketInEvent[];
  tags?: { id: string; label: string; slug: string }[];
}

interface PolymarketEventsResponse {
  events: PolymarketEventRaw[];
  next_cursor: string | null;
}

@Injectable()
export class PolymarketAdapter implements IVenueAdapter {
  readonly venueId = 'polymarket';
  private static readonly MAX_MARKETS = 250;
  // Prevents a single multi-outcome event (e.g. World Cup with 50 teams) from
  // consuming the entire cap before other events are seen.
  private static readonly MAX_MARKETS_PER_EVENT = 5;
  private readonly logger = new Logger(PolymarketAdapter.name);
  private readonly gammaUrl: string;
  private readonly clobUrl: string;

  constructor(
    private readonly http: HttpService,
    config: ConfigService,
  ) {
    this.gammaUrl =
      config.get<string>('POLYMARKET_GAMMA_URL') ??
      'https://gamma-api.polymarket.com';
    this.clobUrl =
      config.get<string>('POLYMARKET_CLOB_URL') ??
      'https://clob.polymarket.com';
  }

  async fetchMarkets(_params?: MarketQueryParams): Promise<NormalizedMarket[]> {
    const results: NormalizedMarket[] = [];
    let nextCursor: string | null = null;
    const limit = 100;

    do {
      const res = await firstValueFrom(
        this.http.get<PolymarketEventsResponse>(`${this.gammaUrl}/events/keyset`, {
          params: {
            limit,
            active: 'true',
            closed: 'false',
            ...(nextCursor ? { next_cursor: nextCursor } : {}),
          },
        }),
      );

      const events: PolymarketEventRaw[] = res.data?.events ?? [];
      nextCursor = res.data?.next_cursor || null;

      for (const event of events) {
        results.push(...this.normaliseEvent(event));
        if (results.length >= PolymarketAdapter.MAX_MARKETS) {
          nextCursor = null;
          break;
        }
      }
    } while (nextCursor);

    const capped = results.slice(0, PolymarketAdapter.MAX_MARKETS);
    this.logger.log(`Polymarket fetched ${capped.length} markets (cap: ${PolymarketAdapter.MAX_MARKETS})`);
    return capped;
  }

  async fetchMarket(venueMarketId: string): Promise<NormalizedMarket> {
    const res = await firstValueFrom(
      this.http.get<PolymarketMarketInEvent>(
        `${this.gammaUrl}/markets/${venueMarketId}`,
      ),
    );
    // Minimal event wrapper to reuse normaliseMarket
    return this.normaliseMarket(res.data, {
      eventSlug: res.data.slug,
      eventImage: res.data.image,
      eventIcon: res.data.icon,
      eventDescription: res.data.description,
      eventCategory: null,
      eventVolume24h: res.data.volume24hr ?? 0,
      eventLiquidity: Number(res.data.liquidity ?? 0),
      eventCreationDate: res.data.startDate,
    });
  }

  async fetchOrderBook(venueMarketId: string): Promise<NormalizedOrderBook> {
    const res = await firstValueFrom(
      this.http.get<{ bids: { price: string; size: string }[]; asks: { price: string; size: string }[] }>(
        `${this.clobUrl}/book`,
        { params: { token_id: venueMarketId } },
      ),
    );
    return {
      venueMarketId,
      outcome: 'YES',
      bids: res.data.bids.map((b) => ({ price: Number(b.price), size: Number(b.size) })),
      asks: res.data.asks.map((a) => ({ price: Number(a.price), size: Number(a.size) })),
      timestamp: new Date(),
    };
  }

  async getQuote(_params: QuoteParams): Promise<NormalizedQuote> {
    throw new Error('Polymarket getQuote not yet implemented');
  }

  subscribeToPrice(_venueMarketId: string, _cb: PriceCallback): Unsubscribe {
    throw new Error('Polymarket subscribeToPrice not yet implemented');
  }

  async placeOrder(_params: PlaceOrderParams): Promise<NormalizedOrder> {
    throw new Error('Polymarket placeOrder not yet implemented');
  }

  async cancelOrder(_venueOrderId: string): Promise<void> {
    throw new Error('Polymarket cancelOrder not yet implemented');
  }

  async getOrder(_venueOrderId: string): Promise<NormalizedOrder> {
    throw new Error('Polymarket getOrder not yet implemented');
  }

  // CLOB API supports interval shortcuts ('1w', '1m') or explicit startTs/endTs
  // with a max window of ~14 days. For 3M and all, we chunk into 14-day windows.
  async fetchPriceHistory(
    _venueMarketId: string,
    range: string,
    opts?: { tokenId?: string },
  ): Promise<import('../interfaces/venue-adapter.interface').PriceHistoryPoint[]> {
    const tokenId = opts?.tokenId;
    if (!tokenId) return [];

    if (range === '1W') return this.fetchByInterval(tokenId, '1w', 60);
    if (range === '1M') return this.fetchByInterval(tokenId, '1m', 1440);

    const now = Math.floor(Date.now() / 1000);
    const startTs = range === '3M' ? now - 90 * 86_400 : now - 365 * 86_400;
    return this.fetchChunked(tokenId, startTs, now, 1440);
  }

  // ─── Normalisation ────────────────────────────────────────────────────────

  private normaliseEvent(event: PolymarketEventRaw): NormalizedMarket[] {
    const markets = event.markets ?? [];
    const eventMeta = {
      eventSlug: event.slug,
      eventImage: event.image,
      eventIcon: event.icon,
      eventDescription: event.description,
      eventCategory: event.category,
      eventVolume24h: event.volume24hr ?? 0,
      eventLiquidity: event.liquidity ?? 0,
      eventCreationDate: event.creationDate ?? event.startDate,
    };

    return markets
      .filter((m) => m.active && !m.closed)
      .slice(0, PolymarketAdapter.MAX_MARKETS_PER_EVENT)
      .map((m) => this.normaliseMarket(m, eventMeta));
  }

  private normaliseMarket(
    market: PolymarketMarketInEvent,
    meta: {
      eventSlug: string | null;
      eventImage: string | null;
      eventIcon: string | null;
      eventDescription: string | null;
      eventCategory: string | null;
      eventVolume24h: number;
      eventLiquidity: number;
      eventCreationDate: string | null | undefined;
    },
  ): NormalizedMarket {
    const outcomes = this.parseOutcomes(market);

    const marketUrl = meta.eventSlug
      ? `https://polymarket.com/event/${meta.eventSlug}`
      : market.slug
        ? `https://polymarket.com/event/${market.slug}`
        : undefined;

    return {
      id: market.conditionId,
      venueId: this.venueId,
      venueMarketId: market.conditionId,
      title: market.question,
      description: meta.eventDescription ?? market.description ?? undefined,
      image: meta.eventImage ?? market.image ?? undefined,
      icon: meta.eventIcon ?? market.icon ?? undefined,
      ticker: market.conditionId,
      marketUrl,
      category: meta.eventCategory ?? 'general',
      outcomes,
      resolutionDate: market.endDate ? new Date(market.endDate) : null,
      openDate: market.startDate ? new Date(market.startDate) : null,
      status: 'open',
      engine: 'clob',
      volume24h: market.volume24hr ?? meta.eventVolume24h,
      liquidity: Number(market.liquidity ?? meta.eventLiquidity),
      createdAt: meta.eventCreationDate
        ? new Date(meta.eventCreationDate)
        : new Date(),
    };
  }

  private parseOutcomes(market: PolymarketMarketInEvent) {
    const parse = (s: string | null | undefined): string[] => {
      if (!s) return [];
      try { return JSON.parse(s) as string[]; } catch { return []; }
    };

    const labels = parse(market.outcomes);
    if (labels.length === 0) return [];

    const prices = parse(market.outcomePrices);
    const tokenIds = parse(market.clobTokenIds);

    const isBinary =
      labels.length === 2 &&
      labels[0].toLowerCase() === 'yes' &&
      labels[1].toLowerCase() === 'no';

    return labels.map((label, i) => ({
      id: tokenIds[i] ?? `${market.conditionId}-${i}`,
      label,
      price: parseFloat(prices[i] ?? '0'),
      shares: 0,
      yesMint: isBinary ? (tokenIds[0] ?? undefined) : (tokenIds[i] ?? undefined),
      noMint: isBinary ? (tokenIds[1] ?? undefined) : undefined,
    }));
  }

  // ─── Price history helpers ────────────────────────────────────────────────

  private async fetchByInterval(
    tokenId: string,
    interval: string,
    fidelity: number,
  ): Promise<import('../interfaces/venue-adapter.interface').PriceHistoryPoint[]> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ history: { t: number; p: number }[] }>(
          `${this.clobUrl}/prices-history`,
          { params: { market: tokenId, interval, fidelity } },
        ),
      );
      return this.mapHistory(res.data?.history);
    } catch {
      return [];
    }
  }

  private async fetchChunked(
    tokenId: string,
    startTs: number,
    endTs: number,
    fidelity: number,
  ): Promise<import('../interfaces/venue-adapter.interface').PriceHistoryPoint[]> {
    const CHUNK_SEC = 14 * 86_400;
    const chunks: { start: number; end: number }[] = [];
    for (let s = startTs; s < endTs; s += CHUNK_SEC) {
      chunks.push({ start: s, end: Math.min(s + CHUNK_SEC, endTs) });
    }

    const results = await Promise.all(
      chunks.map(({ start, end }) =>
        firstValueFrom(
          this.http.get<{ history: { t: number; p: number }[] }>(
            `${this.clobUrl}/prices-history`,
            { params: { market: tokenId, startTs: start, endTs: end, fidelity } },
          ),
        )
          .then((r) => this.mapHistory(r.data?.history))
          .catch(() => [] as import('../interfaces/venue-adapter.interface').PriceHistoryPoint[]),
      ),
    );

    return results.flat().sort((a, b) => a.time.getTime() - b.time.getTime());
  }

  private mapHistory(
    history: { t: number; p: number }[] | null | undefined,
  ): import('../interfaces/venue-adapter.interface').PriceHistoryPoint[] {
    return (history ?? []).map((h) => ({
      time: new Date(h.t * 1000),
      price: h.p,
    }));
  }
}
