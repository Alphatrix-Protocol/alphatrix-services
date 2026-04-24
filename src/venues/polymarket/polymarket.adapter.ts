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

interface PolymarketMarketRaw {
  id: string;
  conditionId: string;
  question: string;
  category: string | null;
  endDate: string | null;
  startDate: string | null;
  active: boolean;
  closed: boolean;
  volume: string | number | null;
  liquidity: string | number | null;
  tokens: { token_id: string; outcome: string; price: number }[] | null;
}

// Gamma API returns the array directly at the top level
type PolymarketMarketsResponse = PolymarketMarketRaw[];

@Injectable()
export class PolymarketAdapter implements IVenueAdapter {
  readonly venueId = 'polymarket';
  private readonly logger = new Logger(PolymarketAdapter.name);
  private readonly gammaUrl: string;
  private readonly clobUrl: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.gammaUrl =
      config.get<string>('POLYMARKET_GAMMA_URL') ??
      'https://gamma-api.polymarket.com';
    this.clobUrl =
      config.get<string>('POLYMARKET_CLOB_URL') ??
      'https://clob.polymarket.com';
  }

  // Fetch only active markets — Polymarket has 10k+ total but ~500 active
  async fetchMarkets(_params?: MarketQueryParams): Promise<NormalizedMarket[]> {
    const results: NormalizedMarket[] = [];
    const limit = 100;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const res = await firstValueFrom(
        this.http.get<PolymarketMarketsResponse>(`${this.gammaUrl}/markets`, {
          params: { limit, offset, active: 'true', closed: 'false' },
        }),
      );
      const page = Array.isArray(res.data) ? res.data : [];
      results.push(...page.map((m) => this.normalise(m)));
      hasMore = page.length === limit;
      offset += limit;
    }

    this.logger.log(`Polymarket fetched ${results.length} active markets`);
    return results;
  }

  async fetchMarket(venueMarketId: string): Promise<NormalizedMarket> {
    const res = await firstValueFrom(
      this.http.get<PolymarketMarketRaw>(
        `${this.gammaUrl}/markets/${venueMarketId}`,
      ),
    );
    return this.normalise(res.data);
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

  // ─── Normalisation ───────────────────────────────────────────────────────

  private normalise(raw: PolymarketMarketRaw): NormalizedMarket {
    let status: 'open' | 'closed' | 'resolved' = 'open';
    if (raw.closed) status = 'resolved';
    else if (!raw.active) status = 'closed';

    return {
      id: raw.conditionId ?? raw.id,
      venueId: this.venueId,
      venueMarketId: raw.conditionId ?? raw.id,
      title: raw.question,
      category: raw.category ?? 'general',
      outcomes: (raw.tokens ?? []).map((t) => ({
        id: t.token_id,
        label: t.outcome,
        price: t.price,
        shares: 0,
      })),
      resolutionDate: raw.endDate ? new Date(raw.endDate) : null,
      status,
      engine: 'clob',
      volume24h: Number(raw.volume ?? 0),
      liquidity: Number(raw.liquidity ?? 0),
      createdAt: raw.startDate ? new Date(raw.startDate) : new Date(),
    };
  }
}
