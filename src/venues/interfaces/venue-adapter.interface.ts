export interface NormalizedOutcome {
  id: string;
  label: string;
  price: number;          // 0–1 probability
  shares: number;
  ticker?: string;        // venue-specific short symbol (e.g. Kalshi ticker)
  marketUrl?: string;     // direct link to this outcome on the venue
  volume?: number;        // total lifetime volume for this outcome
  volume24h?: number;
  openInterest?: number;
  yesMint?: string;       // Solana YES token mint (or Polymarket token_id)
  noMint?: string;        // Solana NO token mint
}

export interface NormalizedMarket {
  id: string;
  venueId: string;
  venueMarketId: string;
  title: string;
  description?: string;
  image?: string;
  icon?: string;
  ticker?: string;
  marketUrl?: string;
  category: string;
  outcomes: NormalizedOutcome[];
  resolutionDate: Date | null;
  openDate?: Date | null;
  status: 'open' | 'closed' | 'resolved';
  engine: 'clob' | 'amm';
  volume24h: number;
  liquidity: number;
  openInterest?: number;
  velocity1h?: number;
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

export interface PriceHistoryPoint {
  time: Date;
  price: number; // 0–1 probability
}

export type PriceCallback = (price: number, outcome: string) => void;
export type Unsubscribe = () => void;

export const VENUE_ADAPTER = 'VENUE_ADAPTER';

export interface IVenueAdapter {
  readonly venueId: string;

  fetchMarkets(params?: MarketQueryParams): Promise<NormalizedMarket[]>;
  fetchMarket(venueMarketId: string): Promise<NormalizedMarket>;
  fetchOrderBook(venueMarketId: string): Promise<NormalizedOrderBook>;
  fetchPriceHistory(venueMarketId: string, range: string, opts?: { tokenId?: string }): Promise<PriceHistoryPoint[]>;

  getQuote(params: QuoteParams): Promise<NormalizedQuote>;
  subscribeToPrice(venueMarketId: string, cb: PriceCallback): Unsubscribe;

  placeOrder(params: PlaceOrderParams): Promise<NormalizedOrder>;
  cancelOrder(venueOrderId: string): Promise<void>;
  getOrder(venueOrderId: string): Promise<NormalizedOrder>;
}
