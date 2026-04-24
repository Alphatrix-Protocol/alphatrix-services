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
  condition_id: string;
  question: string;
  category: string;
  end_date_iso: string | null;
  active: boolean;
  closed: boolean;
  volume: number;
  liquidity: number;
  created_at: string;
  tokens: { token_id: string; outcome: string; price: number }[];
}

interface PolymarketMarketsResponse {
  data: PolymarketMarketRaw[];
  next_cursor: string | null;
}

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

  // Walks all cursor pages and returns every market normalised
  async fetchMarkets(_params?: MarketQueryParams): Promise<NormalizedMarket[]> {
    const results: NormalizedMarket[] = [];
    let nextCursor: string | null = null;

    do {
      const res = await firstValueFrom(
        this.http.get<PolymarketMarketsResponse>(`${this.gammaUrl}/markets`, {
          params: nextCursor ? { next_cursor: nextCursor } : {},
        }),
      );
      const { data, next_cursor } = res.data;
      results.push(...data.map((m) => this.normalise(m)));
      nextCursor = next_cursor ?? null;
    } while (nextCursor);

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
      id: raw.condition_id,
      venueId: this.venueId,
      venueMarketId: raw.condition_id,
      title: raw.question,
      category: raw.category ?? 'general',
      outcomes: (raw.tokens ?? []).map((t) => ({
        id: t.token_id,
        label: t.outcome,
        price: t.price,
        shares: 0,
      })),
      resolutionDate: raw.end_date_iso ? new Date(raw.end_date_iso) : null,
      status,
      engine: 'clob',
      volume24h: raw.volume ?? 0,
      liquidity: raw.liquidity ?? 0,
      createdAt: raw.created_at ? new Date(raw.created_at) : new Date(),
    };
  }
}
