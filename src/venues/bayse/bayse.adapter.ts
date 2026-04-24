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
  outcome: string;
  price: number;
}

interface BayseEventRaw {
  id: string;
  title: string;
  category: string;
  engine: 'clob' | 'amm';
  status: 'open' | 'closed' | 'resolved';
  resolutionDate: string | null;
  volume24h: number;
  liquidity: number;
  createdAt: string;
  markets: BayseMarketRaw[];
}

interface BayseEventsResponse {
  data: BayseEventRaw[];
}

const PAGE_SIZE = 50;

@Injectable()
export class BayseAdapter implements IVenueAdapter {
  readonly venueId = 'bayse';
  private readonly logger = new Logger(BayseAdapter.name);
  private readonly baseUrl: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.baseUrl =
      config.get<string>('BAYSE_BASE_URL') ?? 'https://relay.bayse.markets';
  }

  // Walks all pages (page + size) and returns every event normalised
  async fetchMarkets(_params?: MarketQueryParams): Promise<NormalizedMarket[]> {
    const results: NormalizedMarket[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const res = await firstValueFrom(
        this.http.get<BayseEventsResponse>(`${this.baseUrl}/v1/pm/events`, {
          params: { page, size: PAGE_SIZE },
        }),
      );
      const events = res.data.data;
      results.push(...events.map((e) => this.normalise(e)));
      hasMore = events.length === PAGE_SIZE;
      page++;
    }

    return results;
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
        { params: { marketId: venueMarketId } },
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

  // ─── Normalisation ───────────────────────────────────────────────────────

  private normalise(raw: BayseEventRaw): NormalizedMarket {
    return {
      id: raw.id,
      venueId: this.venueId,
      venueMarketId: raw.id,
      title: raw.title,
      category: raw.category ?? 'general',
      outcomes: (raw.markets ?? []).map((m) => ({
        id: m.id,
        label: m.outcome,
        price: m.price,
        shares: 0,
      })),
      resolutionDate: raw.resolutionDate ? new Date(raw.resolutionDate) : null,
      status: raw.status ?? 'open',
      engine: raw.engine ?? 'clob',
      volume24h: raw.volume24h ?? 0,
      liquidity: raw.liquidity ?? 0,
      createdAt: raw.createdAt ? new Date(raw.createdAt) : new Date(),
    };
  }
}
