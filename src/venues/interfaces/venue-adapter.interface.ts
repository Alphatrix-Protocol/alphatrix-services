export interface NormalizedOutcome {
  id: string;
  label: string;
  price: number;
  shares: number;
}

export interface NormalizedMarket {
  id: string;
  venueId: string;
  venueMarketId: string;
  title: string;
  category: string;
  outcomes: NormalizedOutcome[];
  resolutionDate: Date | null;
  status: 'open' | 'closed' | 'resolved';
  engine: 'clob' | 'amm';
  volume24h: number;
  liquidity: number;
  createdAt: Date;
}

export interface NormalizedOrderBook {
  venueMarketId: string;
  outcome: string;
  bids: { price: number; size: number }[];
  asks: { price: number; size: number }[];
  timestamp: Date;
}

export interface NormalizedQuote {
  venueId: string;
  venueMarketId: string;
  outcome: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
}

export interface NormalizedOrder {
  id: string;
  venueOrderId: string;
  venueId: string;
  marketId: string;
  side: 'BUY' | 'SELL';
  outcome: string;
  amount: number;
  price: number | null;
  status: 'pending' | 'open' | 'filled' | 'partial' | 'cancelled' | 'failed';
  filledAmount: number;
  avgFillPrice: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MarketQueryParams {
  cursor?: string;
  page?: number;
  size?: number;
}

export interface QuoteParams {
  venueMarketId: string;
  outcome: string;
  side: 'BUY' | 'SELL';
  amount: number;
}

export interface PlaceOrderParams {
  venueMarketId: string;
  outcome: string;
  side: 'BUY' | 'SELL';
  amount: number;
  price?: number;
}

export type PriceCallback = (price: number, outcome: string) => void;
export type Unsubscribe = () => void;

export const VENUE_ADAPTER = 'VENUE_ADAPTER';

export interface IVenueAdapter {
  readonly venueId: string;

  fetchMarkets(params?: MarketQueryParams): Promise<NormalizedMarket[]>;
  fetchMarket(venueMarketId: string): Promise<NormalizedMarket>;
  fetchOrderBook(venueMarketId: string): Promise<NormalizedOrderBook>;

  getQuote(params: QuoteParams): Promise<NormalizedQuote>;
  subscribeToPrice(venueMarketId: string, cb: PriceCallback): Unsubscribe;

  placeOrder(params: PlaceOrderParams): Promise<NormalizedOrder>;
  cancelOrder(venueOrderId: string): Promise<void>;
  getOrder(venueOrderId: string): Promise<NormalizedOrder>;
}
