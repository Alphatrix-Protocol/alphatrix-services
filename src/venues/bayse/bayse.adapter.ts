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

interface BayseOutcomeRaw {
  id: string;
  label: string;        // 'YES' | 'NO'
  price: number;        // 0–1
  buyPrice: number;
}

interface BayseMarketRaw {
  id: string;
  title: string;
  status: string;
  outcomes: BayseOutcomeRaw[];
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
  openingDate: string | null;
  closingDate: string | null;
  resolutionDate: string | null;
  liquidity: number | null;
  totalVolume: number | null;
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
    } while (page <= lastPage);

    this.logger.log(`Bayse fetched ${results.length} events`);
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

  // ─── Normalisation ───────────────────────────────────────────────────────

  private normalise(raw: BayseEventRaw): NormalizedMarket {
    const resolutionDate = raw.closingDate ?? raw.resolutionDate ?? null;

    // Flatten outcomes across all inner markets (most events have one market with YES/NO)
    const outcomes = (raw.markets ?? []).flatMap((market) =>
      (market.outcomes ?? []).map((o) => ({
        id: o.id,
        label: o.label,
        price: o.price ?? 0,
        shares: 0,
      })),
    );

    return {
      id: raw.id,
      venueId: this.venueId,
      venueMarketId: raw.id,
      title: raw.title ?? raw.slug ?? raw.id,
      category: raw.category ?? 'general',
      outcomes,
      resolutionDate: resolutionDate ? new Date(resolutionDate) : null,
      status: this.normaliseStatus(raw.status),
      engine: raw.engine?.toLowerCase() === 'amm' ? 'amm' : 'clob',
      volume24h: raw.totalVolume ?? 0,
      liquidity: raw.liquidity ?? 0,
      createdAt: raw.openingDate ? new Date(raw.openingDate) : new Date(),
    };
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
