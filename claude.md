# Alpatrix — backend project context for Claude

## Project overview

Alpatrix is a prediction market aggregation and execution layer built on Solana.
The backend is a **NestJS monorepo** — modular by design so new venue integrations
can be plugged in without touching existing code.

Primary focus areas for this codebase:
1. Aggregation service — market discovery, normalisation, price feeds
2. Execution service — order routing, split optimisation, fill management
3. Venue adapters — Polymarket and Bayse Markets (pluggable, one module per venue)
4. Solana programs interface — interaction with on-chain programs via Anchor/web3.js

The frontend (Next.js) is a separate repo. Do not suggest frontend changes.

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend framework | NestJS (TypeScript) |
| Blockchain | Solana |
| On-chain programs | Rust / Anchor |
| Cache | Redis |
| Database | PostgreSQL (with TypeORM) |
| Real-time | WebSockets (NestJS Gateway) |
| Queue / events | Bull (Redis-backed) or Kafka |
| HTTP client | Axios (wrapped per adapter) |
| Config | @nestjs/config + .env |
| Testing | Jest |

---

## NestJS module structure

Every major concern is its own NestJS module. Modules are loosely coupled via
interfaces — adding a new venue = new module that implements the adapter interface.

```
src/
  aggregation/          # Market discovery + normalisation
  execution/            # Order routing + split logic
  venues/
    polymarket/         # Polymarket adapter module
    bayse/              # Bayse Markets adapter module
    interfaces/         # IVenueAdapter, IMarket, IOrderBook, IOrder (shared contracts)
  solana/               # Solana program interactions (Anchor client)
  orders/               # Order lifecycle management
  positions/            # Position tracking
  prices/               # Price feed workers + Redis cache
  websocket/            # NestJS WebSocket gateway (push to frontend)
  common/               # Shared DTOs, pipes, guards, interceptors
  config/               # ConfigModule setup
```

---

## The adapter interface pattern (critical)

Every venue adapter implements `IVenueAdapter`. This is the modularity contract.
The aggregation and execution layers only ever call this interface — never a
venue-specific class directly.

```typescript
export interface IVenueAdapter {
  readonly venueId: string;                        // e.g. 'polymarket' | 'bayse'

  // Market discovery
  fetchMarkets(params?: MarketQueryParams): Promise<NormalizedMarket[]>;
  fetchMarket(venueMarketId: string): Promise<NormalizedMarket>;
  fetchOrderBook(venueMarketId: string): Promise<NormalizedOrderBook>;

  // Pricing
  getQuote(params: QuoteParams): Promise<NormalizedQuote>;
  subscribeToPrice(venueMarketId: string, cb: PriceCallback): Unsubscribe;

  // Execution
  placeOrder(params: PlaceOrderParams): Promise<NormalizedOrder>;
  cancelOrder(venueOrderId: string): Promise<void>;
  getOrder(venueOrderId: string): Promise<NormalizedOrder>;
}
```

Adding Kalshi, Manifold, or any future venue = implement this interface in a new
module. Nothing else in the codebase changes.

---

## Normalised internal types

All venue-specific data is converted to these canonical types at the adapter boundary.
Everything above the adapter layer speaks only these types.

```typescript
// Unified market representation
interface NormalizedMarket {
  id: string;                    // Alpatrix internal ID
  venueId: string;               // 'polymarket' | 'bayse'
  venueMarketId: string;         // venue's own ID
  title: string;
  description?: string;
  image?: string;                // cover image URL (Polymarket)
  icon?: string;                 // small icon URL (Polymarket)
  ticker?: string;               // venue-specific short symbol
  marketUrl?: string;            // direct link to market on the venue
  category: string;
  outcomes: NormalizedOutcome[];  // 2 for binary YES/NO; N for categorical (Kalshi)
  resolutionDate: Date | null;
  openDate?: Date | null;
  status: 'open' | 'closed' | 'resolved';
  engine: 'clob' | 'amm';        // important for routing logic
  volume24h: number;
  liquidity: number;
  openInterest?: number;
  velocity1h?: number;
  createdAt: Date;
}

interface NormalizedOutcome {
  id: string;
  label: string;                 // 'YES' | 'NO' for binary; arbitrary label for categorical
  price: number;                 // 0–1 probability
  shares: number;
  ticker?: string;               // per-outcome ticker (Kalshi)
  marketUrl?: string;            // direct link to this outcome on the venue
  volume?: number;               // lifetime volume for this outcome
  volume24h?: number;
  openInterest?: number;
  yesMint?: string;              // Solana YES token mint (or Polymarket token_id)
  noMint?: string;               // Solana NO token mint
}

interface NormalizedOrderBook {
  venueMarketId: string;
  outcome: string;
  bids: { price: number; size: number }[];
  asks: { price: number; size: number }[];
  timestamp: Date;
}

interface NormalizedOrder {
  id: string;                    // Alpatrix internal ID
  venueOrderId: string;
  venueId: string;
  marketId: string;
  side: 'BUY' | 'SELL';
  outcome: string;
  amount: number;
  price: number | null;          // null = market order
  status: 'pending' | 'open' | 'filled' | 'partial' | 'cancelled' | 'failed';
  filledAmount: number;
  avgFillPrice: number | null;
  createdAt: Date;
  updatedAt: Date;
}
```

---

## Venue 1: Polymarket

- **Type**: CLOB (central limit order book)
- **Chain**: Polygon (on-chain execution)
- **Docs**: https://docs.polymarket.com
- **Base URL**: https://clob.polymarket.com (CLOB API) + https://gamma-api.polymarket.com (markets)
- **Auth**: ECDSA wallet signing (private key signs each order)
- **Settlement**: On-chain Polygon → bridged to Solana for final settlement

### Key Polymarket endpoints used
| Purpose | Endpoint |
|---|---|
| List markets | `GET /markets` |
| Get market | `GET /markets/{conditionId}` |
| Get order book | `GET /book?token_id={tokenId}` |
| Place order | `POST /order` |
| Cancel order | `DELETE /order/{orderId}` |
| Get order | `GET /orders/{orderId}` |
| Midpoint price | `GET /midpoints?token_id={tokenId}` |

### Polymarket notes
- Markets identified by `conditionId`; outcomes identified by `tokenId`
- Orders signed with EIP-712 on Polygon — adapter handles all signing
- YES token + NO token always sum to 1 USDC
- WebSocket available at wss://ws-subscriptions-clob.polymarket.com for live feeds

---

## Venue 2: Bayse Markets

- **Type**: CLOB **and** AMM (each event uses one engine — check `event.engine`)
- **Chain**: Off-chain (centralised matching), Solana-native platform
- **Docs**: https://docs.bayse.markets
- **Base URL**: `https://relay.bayse.markets`
- **WebSocket**: `wss://socket.bayse.markets`
- **Currency**: USD, NGN, and more (multi-currency — always use USD for Alpatrix)

### Bayse authentication
Three levels:
- **Public** — no auth (market data, order books, prices)
- **Read** — `X-Public-Key: pk_live_...` header
- **Write** — `X-Public-Key` + `X-Timestamp` + `X-Signature` (HMAC-SHA256)

HMAC signing payload format: `{timestamp}.{METHOD}.{path}.{bodyHash}`
- `bodyHash` = SHA-256 hex digest of raw request body (empty string if no body)
- `signature` = HMAC-SHA256 of payload using secret key, base64-encoded
- Timestamp window: 5 minutes (server rejects stale requests)
- Keys: `pk_live_*` (public, safe in headers) + `sk_live_*` (secret, never expose)

### Key Bayse endpoints used
| Purpose | Endpoint | Auth |
|---|---|---|
| List events | `GET /v1/pm/events` | Public |
| Get event | `GET /v1/pm/events/{eventId}` | Public |
| Get order book | `GET /v1/pm/books` | Public |
| Get ticker | `GET /v1/pm/markets/{marketId}/ticker` | Public |
| Get price history | `GET /v1/pm/events/{eventId}/price-history` | Public |
| Get quote | `POST /v1/pm/events/{eventId}/markets/{marketId}/quote` | Public |
| Place order | `POST /v1/pm/events/{eventId}/markets/{marketId}/orders` | Write |
| Cancel order | `DELETE /v1/pm/orders/{orderId}` | Write |
| Get order | `GET /v1/pm/orders/{orderId}` | Read |
| List orders | `GET /v1/pm/orders` | Read |
| Get portfolio | `GET /v1/pm/portfolio` | Read |
| Get PnL | `GET /v1/pm/get-pnl` | Read |
| Wallet assets | `GET /v1/wallet/assets` | Read |

### Bayse order payload (CLOB)
```json
{ "side": "BUY", "outcome": "YES", "amount": 100, "price": 0.65, "currency": "USD" }
```

### Bayse order payload (AMM — no price field)
```json
{ "side": "BUY", "outcome": "YES", "amount": 100, "currency": "USD" }
```

### Bayse WebSocket channels
- Connect: `wss://socket.bayse.markets/ws/v1/markets`
- Subscribe to prices: `{ "type": "subscribe", "channel": "prices", "eventId": "..." }`
- Subscribe to order book: `{ "type": "subscribe", "channel": "orderbook", "marketId": "..." }`
- Note: server may batch messages in a single frame separated by `\n` — always split on `\n` before parsing

### Bayse key concepts
- **Event** = a question (e.g. "Will BTC reach $100K?") — has one `engine` (AMM or CLOB)
- **Market** = an outcome within an event (YES or NO side)
- **Outcome** = the tradeable side (YES / NO)
- Each event's `engine` field determines order format — adapter must handle both
- Pagination: `?page=1&size=20` on list endpoints
- Error format: `{ "error": "error_code", "message": "...", "statusCode": 400 }`

---

## Aggregation service responsibilities

The aggregation service sits above all venue adapters. It solves four distinct
problems in order — fetch, match, sync, and serve. Each layer feeds the next.

---

### Layer 1 — Fetch (market metadata)

A Bull cron job runs every **60 seconds**. It calls both venue adapters, walks
all pagination pages, normalises responses into `NormalizedMarket`, and upserts
into Postgres. This is the source of truth for market metadata.

**Pagination is required — do not stop at page 1:**

```typescript
// Polymarket: cursor-based pagination
async fetchAllPolymarkets(): Promise<NormalizedMarket[]> {
  const results = [];
  let nextCursor = null;
  do {
    const res = await this.clobClient.get('/markets',
      { params: nextCursor ? { next_cursor: nextCursor } : {} });
    results.push(...res.data.data);
    nextCursor = res.data.next_cursor; // null when exhausted
  } while (nextCursor);
  return results.map(m => this.normalise(m));
}

// Bayes: page + size pagination
async fetchAllBayesEvents(): Promise<NormalizedMarket[]> {
  const results = [];
  let page = 1;
  let hasMore = true;
  while (hasMore) {
    const res = await this.bayesClient.get('/v1/pm/events',
      { params: { page, size: 50 } });
    results.push(...res.data.data);
    hasMore = res.data.data.length === 50;
    page++;
  }
  return results.map(e => this.normalise(e));
}
```

**Upsert strategy — never delete and re-insert:**

```typescript
await this.marketRepo
  .createQueryBuilder()
  .insert()
  .into(Market)
  .values(market)
  .orUpdate(
    ['title', 'status', 'resolution_date', 'volume24h', 'liquidity', 'updated_at'],
    ['venue_id', 'venue_market_id'],
  )
  // NEVER include match_group_id in the update columns — matching handles that
  .execute();
```

---

### Layer 2 — Market matching

After each fetch cycle, a matching job runs against all markets with
`matchGroupId = null`. It compares unmatched markets across venues using
three signals combined into a confidence score.

**Algorithm:**

```typescript
function scoreMarketPair(a: NormalizedMarket, b: NormalizedMarket): number {
  const titleScore    = diceCoefficient(normaliseTitle(a.title), normaliseTitle(b.title));
  const categoryScore = a.category === b.category ? 1 : 0;
  const dateScore     = dateProximity(a.resolutionDate, b.resolutionDate);
  // Weighted: title carries most signal
  return (titleScore * 0.6) + (categoryScore * 0.2) + (dateScore * 0.2);
}

const MATCH_THRESHOLD      = 0.75; // auto-match above this
const REVIEW_THRESHOLD     = 0.50; // flag for manual review above this
```

**Title normalisation before comparing:**

```typescript
function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\b(will|the|a|an|by|in|on|for|to|of)\b/g, '')
    .replace(/\s+/g, ' ').trim();
}
```

Use **Sørensen–Dice coefficient on bigrams** for title similarity — better
than Levenshtein for market titles. Install `natural` or implement directly.

**Match outcomes:**
- Score ≥ 0.75 → auto-match, create `MarketGroup`, set `matchGroupId` on both markets
- Score 0.50–0.74 → insert into `MatchReviewQueue` for manual approval
- Score < 0.50 → no match, each market stays as its own single-venue group

**Important:** false positives (wrong matches) are worse than false negatives.
A wrong match shows users incorrect blended prices. Start conservative.

---

### Layer 3 — Real-time price sync

Two persistent WebSocket connections, one per venue. On every price/book event,
write to Redis with a 2-second TTL. The execution layer reads exclusively from
Redis — never from Postgres — during order routing.

**Connection management (NestJS lifecycle):**

```typescript
@Injectable()
export class PriceSyncService implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.connectPolymarket();
    await this.connectBayes();
  }
  onModuleDestroy() {
    this.polyWs?.close();
    this.bayesWs?.close();
  }
  private reconnect(venue: string, delayMs: number) {
    setTimeout(() => venue === 'polymarket'
      ? this.connectPolymarket()
      : this.connectBayes(),
      Math.min(delayMs * 2, 30_000) // exponential backoff, max 30s
    );
  }
}
```

**Bayes WebSocket — critical gotcha:**
Bayes may send multiple JSON messages in a single WebSocket frame separated
by `\n`. Always split on newline before parsing:

```typescript
this.bayesWs.on('message', (rawData: Buffer) => {
  const frames = rawData.toString().split('\n').filter(Boolean);
  for (const frame of frames) {
    try { this.handleBayesEvent(JSON.parse(frame)); }
    catch (e) { this.logger.warn('Bad Bayes frame', frame); }
  }
});
```

**Redis key schema:**

```
price:{venueId}:{venueMarketId}:{outcome}   → price string    TTL: 2s
book:{venueId}:{venueMarketId}              → order book JSON  TTL: 2s
bestprice:{matchGroupId}:{outcome}          → best cross-venue JSON  TTL: 2s
```

On every price event: write venue-specific price, then recompute and write
`bestprice:{matchGroupId}` by comparing all venues in that group.

**Fallback if WebSocket drops:**
A 500ms Bull job polls both venue REST APIs for order book snapshots and
writes to Redis. This keeps prices fresh if the WS connection is down.
Under normal operation this job is a safety net only — the WS drives pricing.

---

### Layer 4 — Serve

Two read paths — never mix them:

| Path | Source | Use case |
|---|---|---|
| Metadata | Postgres (60s in-memory cache) | Market list, categories, titles, resolution dates |
| Live prices | Redis only | Order routing, quote generation, frontend price display |

**Unified market response shape (from `GET /markets/:id`):**

The `:id` can be a `MarketGroup` UUID, a `Market` UUID, or a `venueMarketId` — the
endpoint tries all three. Prices come from `rawData.outcomes` (Postgres), not Redis,
at this layer. All prices are in cents (0–100).

```typescript
{
  event: {
    id:          string,
    title:       string,
    description: string | null,
    category:    string,
    image:       string | null,
    icon:        string | null,
    endDate:     string | null,   // ISO 8601
    status:      'open' | 'closed' | 'resolved',
  },
  brief: {
    volume:            number,   // total volume across all venues
    liquidity:         number,   // total liquidity across all venues
    marketProbability: number,   // best YES price in cents (0–100)
  },
  venues: [{
    venueId:       string,
    venueMarketId: string,
    ticker:        string | null,
    marketUrl:     string | null,
    yesPrice:      number,        // cents — shortcut for binary markets
    noPrice:       number,        // cents — shortcut for binary markets
    openInterest:  number | null,
    volume24h:     number,
    liquidity:     number,
    outcomes: [{                  // full per-outcome data; N entries for categorical
      id:           string,
      label:        string,
      price:        number,       // cents (0–100)
      ticker:       string | null,
      marketUrl:    string | null,
      volume:       number | null,
      volume24h:    number | null,
      openInterest: number | null,
      yesMint:      string | null,
      noMint:       string | null,
    }],
  }],
}
```

---

### Aggregation DB schema (TypeORM entities)

```typescript
// src/aggregation/entities/market-group.entity.ts
@Entity('market_groups')
export class MarketGroup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'canonical_title' })
  canonicalTitle: string;

  @Column()
  category: string;

  @Column({ name: 'resolution_date', type: 'timestamptz', nullable: true })
  resolutionDate: Date | null;

  @Column({ default: 'open' })
  status: string;

  @Column({ name: 'matched_at', type: 'timestamptz', nullable: true })
  matchedAt: Date | null;

  @Column({ name: 'match_score', type: 'float', nullable: true })
  matchScore: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => Market, (m) => m.matchGroup)
  markets: Market[];
}

// src/aggregation/entities/market.entity.ts
@Entity('markets')
@Unique(['venueId', 'venueMarketId'])
@Index(['matchGroupId'])
@Index(['status'])
@Index(['category'])
export class Market {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'match_group_id', nullable: true })
  matchGroupId: string | null;

  @ManyToOne(() => MarketGroup, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'match_group_id' })
  matchGroup: MarketGroup | null;

  @Column({ name: 'venue_id' })
  venueId: string;

  @Column({ name: 'venue_market_id' })
  venueMarketId: string;

  @Column()
  title: string;

  @Column()
  category: string;

  @Column()
  engine: string;  // 'clob' | 'amm'

  @Column({ name: 'resolution_date', type: 'timestamptz', nullable: true })
  resolutionDate: Date | null;

  @Column({ default: 'open' })
  status: string;

  @Column({ name: 'volume24h', type: 'float', default: 0 })
  volume24h: number;

  @Column({ type: 'float', default: 0 })
  liquidity: number;

  @Column({ name: 'raw_data', type: 'jsonb' })
  rawData: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

// src/aggregation/entities/match-review-queue.entity.ts
@Entity('match_review_queue')
export class MatchReviewQueue {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'market_id_a' })
  marketIdA: string;

  @Column({ name: 'market_id_b' })
  marketIdB: string;

  @Column({ name: 'title_a' })
  titleA: string;

  @Column({ name: 'title_b' })
  titleB: string;

  @Column({ type: 'float' })
  score: number;

  @Column({ default: 'pending' })
  status: string;  // pending | approved | rejected

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

Register all three entities in the `AggregationModule` via
`TypeOrmModule.forFeature([MarketGroup, Market, MatchReviewQueue])`.
Run migrations with `typeorm migration:generate` after adding entities.

---

### Aggregation module structure

```
src/aggregation/
  aggregation.module.ts
  aggregation.service.ts          # orchestrates all four layers
  fetch/
    market-fetch.service.ts       # 60s Bull cron, pagination, upsert
    market-fetch.job.ts           # Bull job definition
  matching/
    market-matching.service.ts    # scoring, match group creation
    matching.utils.ts             # diceCoefficient, normaliseTitle, dateProximity
  sync/
    price-sync.service.ts         # WebSocket connections + Redis writes
    price-sync-fallback.job.ts    # 500ms REST fallback job
  serve/
    aggregation.controller.ts     # GET /markets, GET /markets/:id
    aggregation.repository.ts     # Postgres queries for metadata
    price.repository.ts           # Redis reads for live prices
```

---

## Execution service responsibilities

1. Receives an order intent (market, outcome, size, direction)
2. Queries aggregated order books from both venues
3. Runs the split optimiser — decides X% venue A, Y% venue B to minimise slippage
4. Routes each leg to the appropriate venue adapter
5. Tracks fills, handles partial fills, retries failures
6. Publishes fill events to the order service for persistence
7. For limit orders: stores order in DB + Bull queue, monitors price, triggers when condition met

---

## NestJS patterns to follow

- **One module per concern** — aggregation, execution, each venue, solana, orders, prices
- **Injectable adapters** — venues registered as providers behind the `IVenueAdapter` token
- **ConfigService** — all env vars via `@nestjs/config`, never `process.env` directly
- **Interceptors** — logging, error normalisation at the controller level
- **Guards** — auth on execution/order endpoints
- **DTOs + class-validator** — validate all incoming requests
- **Bull queues** — for limit order monitoring and async execution tasks
- **NestJS EventEmitter or Kafka** — internal events between services (order.filled, market.updated)
- **Schedule (@nestjs/schedule)** — for price feed polling workers

---

## Environment variables

```
# Bayse Markets
BAYSE_BASE_URL=https://relay.bayse.markets
BAYSE_WS_URL=wss://socket.bayse.markets
BAYSE_PUBLIC_KEY=pk_live_...
BAYSE_SECRET_KEY=sk_live_...

# Polymarket
POLYMARKET_CLOB_URL=https://clob.polymarket.com
POLYMARKET_GAMMA_URL=https://gamma-api.polymarket.com
POLYMARKET_PRIVATE_KEY=0x...
POLYMARKET_CHAIN_ID=137

# Redis
REDIS_URL=redis://localhost:6379

# Postgres
DATABASE_URL=postgresql://...

# Solana
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_PROGRAM_ID=...
```

---

## Auth module

### Overview

Authentication lives in `src/auth/`. It is a standard NestJS module. The
backend is responsible for:

1. Verifying identity from the frontend (Google OAuth token, passkey assertion,
   magic link token)
2. Creating or retrieving the user record in Postgres
3. Issuing a signed JWT for all subsequent API requests
4. Triggering the wallet generation hook on new user creation (NOT YET
   IMPLEMENTED — see wallet section below)

The frontend handles the OAuth / passkey / magic link UI flow entirely. By the
time a request hits this backend, the frontend has already completed the
auth ceremony and is sending a credential for verification.

---

### Auth methods supported

| Method | What frontend sends | What backend does |
|---|---|---|
| Google OAuth | Google `id_token` (JWT) | Verify with Google, extract email + google_id, upsert user |
| Passkey | WebAuthn assertion (JSON) | Verify assertion against stored credential, retrieve user |
| Magic link | One-time token (from email) | Verify token in DB, mark used, retrieve user |

All three paths converge at the same point: a verified user record in Postgres
and a Alpatrix-issued JWT returned to the frontend.

---

### Module location

```
src/
  auth/
    auth.module.ts
    auth.controller.ts       # POST /auth/google, POST /auth/passkey/verify,
                             # POST /auth/magic-link/send,
                             # POST /auth/magic-link/verify
    auth.service.ts          # core verification logic + JWT issuance
    strategies/
      google.strategy.ts     # Google token verification
      passkey.strategy.ts    # WebAuthn assertion verification
      magic-link.strategy.ts # one-time token verification
    guards/
      jwt.guard.ts           # protects all authenticated routes
      jwt-auth.guard.ts      # alias used on controllers
    decorators/
      current-user.decorator.ts   # @CurrentUser() param decorator
    dto/
      google-auth.dto.ts
      passkey-verify.dto.ts
      magic-link-send.dto.ts
      magic-link-verify.dto.ts
    interfaces/
      jwt-payload.interface.ts
```

---

### Packages

```bash
npm install @nestjs/jwt @nestjs/passport passport passport-jwt
npm install google-auth-library          # Google token verification
npm install @simplewebauthn/server       # WebAuthn / passkey verification
npm install @simplewebauthn/types
npm install nanoid                       # magic link token generation
npm install bcrypt                       # token hashing at rest
npm install @types/bcrypt --save-dev
npm install @types/passport-jwt --save-dev
```

---

### Postgres tables (TypeORM entities)

Add these as TypeORM entities in `src/auth/entities/`. The `User` entity is
the anchor. All other auth entities reference it via foreign keys.

```typescript
// Define these as TypeORM @Entity classes in src/auth/entities/
// Use @PrimaryGeneratedColumn('uuid'), @Column, @ManyToOne etc.
// Column naming: snake_case in DB, camelCase in entity (use @Column({ name: 'google_id' }))

// User entity fields:
// id, email (unique), name (nullable), avatarUrl (nullable),
// googleId (unique, nullable), createdAt, updatedAt
// solanaAddress (nullable), solanaSecretKeyEnc (nullable),
// polygonAddress (nullable), polygonPrivKeyEnc (nullable),
// walletsGeneratedAt (nullable)
// Relations: @OneToMany to Passkey, @OneToMany to MagicLink

// Passkey entity fields:
// id, userId (FK → User), credentialId (unique), credentialPublicKey (bytea),
// counter (bigint), deviceType, backedUp (boolean), transports (text[]),
// createdAt, lastUsedAt (nullable)

// MagicLink entity fields:
// id, userId (FK → User), tokenHash (unique), expiresAt, usedAt (nullable), createdAt
```

---

### JWT payload shape

Every JWT issued by this backend carries this payload. The `userId` is the
primary key. The frontend attaches the JWT as a Bearer token on every request.

```typescript
// src/auth/interfaces/jwt-payload.interface.ts
export interface JwtPayload {
  sub:   string;   // user.id (UUID)
  email: string;
  iat?:  number;   // issued at (set automatically by @nestjs/jwt)
  exp?:  number;   // expiry (set automatically)
}
```

---

### Auth endpoints

```
POST /auth/google
  Body:    { idToken: string }          // Google id_token from frontend
  Returns: { accessToken: string, user: UserDto }

POST /auth/passkey/register/options
  Body:    { email: string }
  Returns: PublicKeyCredentialCreationOptions  // challenge for frontend

POST /auth/passkey/register/verify
  Body:    { email: string, credential: RegistrationResponseJSON }
  Returns: { accessToken: string, user: UserDto }

POST /auth/passkey/login/options
  Body:    { email: string }
  Returns: PublicKeyCredentialRequestOptions   // challenge for frontend

POST /auth/passkey/login/verify
  Body:    { email: string, credential: AuthenticationResponseJSON }
  Returns: { accessToken: string, user: UserDto }

POST /auth/magic-link/send
  Body:    { email: string }
  Returns: { message: 'Magic link sent' }

POST /auth/magic-link/verify
  Body:    { token: string }
  Returns: { accessToken: string, user: UserDto }

GET  /auth/me                           // requires JWT
Returns: UserDto
```

---

### Google auth flow (backend side)

The frontend signs in with Google via the Google Identity SDK and receives a
Google `id_token`. It sends that token to `POST /auth/google`. The backend
verifies it with Google's servers using `google-auth-library` — never trust
the token without verification.

```typescript
// src/auth/strategies/google.strategy.ts
import { OAuth2Client } from 'google-auth-library';

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

async verifyGoogleToken(idToken: string) {
  const ticket = await client.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  // payload.sub    = Google user ID
  // payload.email  = verified email
  // payload.name   = display name
  // payload.picture = avatar URL
  return payload;
}
```

After verification, upsert the user:
- If `googleId` exists in DB → returning user, issue JWT
- If email exists but no `googleId` → link Google to existing account
- If neither → new user, create record, trigger wallet hook (when ready)

---

### Passkey flow (backend side)

Uses `@simplewebauthn/server`. Two separate ceremonies: registration (first
time, creates a credential) and authentication (subsequent logins, verifies
a credential).

**Registration:**
1. `POST /auth/passkey/register/options` — generate a challenge, store it
   temporarily in Redis (TTL 5 min), return options to frontend
2. Frontend calls WebAuthn API, user approves biometric, sends assertion back
3. `POST /auth/passkey/register/verify` — call `verifyRegistrationResponse()`
   from `@simplewebauthn/server`, store the `Passkey` record in DB

**Authentication:**
1. `POST /auth/passkey/login/options` — generate a challenge, look up user's
   existing `Passkey` records, return options
2. Frontend calls WebAuthn API, sends assertion
3. `POST /auth/passkey/login/verify` — call `verifyAuthenticationResponse()`,
   update the `counter` field to prevent replay attacks, issue JWT

Challenge storage: use Redis with a short TTL (5 minutes). Key:
`passkey:challenge:{email}`. Delete after use.

---

### Magic link flow (backend side)

1. `POST /auth/magic-link/send`
   - Look up or create the user by email
   - Generate a cryptographically random token: `nanoid(48)`
   - Hash it with `bcrypt` before storing (same principle as password hashing)
   - Store `MagicLink` record in DB with `expiresAt = now + 15 minutes`
   - Send the raw token in the email link:
     `https://alpatrix.io/auth/verify?token={rawToken}`
   - Never store the raw token — only the hash

2. `POST /auth/magic-link/verify`
   - Receive the raw token from the frontend
   - Find `MagicLink` records where `usedAt IS NULL` and `expiresAt > now`
   - For each candidate, compare raw token against stored hash with `bcrypt.compare()`
   - If match found: mark `usedAt = now`, issue JWT
   - If no match or expired: return 401

---

### JWT guard — protecting routes

Every controller that requires auth adds `@UseGuards(JwtAuthGuard)`. The guard
validates the Bearer token and attaches the user to the request.

```typescript
// Usage on any protected controller or route:
@UseGuards(JwtAuthGuard)
@Get('profile')
getProfile(@CurrentUser() user: User) {
  return user;
}
```

The `@CurrentUser()` decorator extracts `req.user` which is populated by the
JWT strategy after token verification.

---

### New user hook — wallet generation (NOT YET IMPLEMENTED)

When a new user is created by any auth method, the auth service must call
a wallet generation hook. This hook is not built yet.

**What Claude should do now:**
- Create a `WalletService` stub in `src/auth/wallet.service.ts` (or
  `src/wallet/wallet.service.ts`)
- The stub should have a `generateWalletsForUser(userId: string): Promise<void>`
  method that logs a message and returns without doing anything
- Wire it into the auth service so it is called after every new user creation
- Do NOT implement the actual key generation, encryption, or DB writes yet
- The wallet generation implementation will come in a separate task

```typescript
// src/wallet/wallet.service.ts  — STUB ONLY, not implemented yet
@Injectable()
export class WalletService {
  async generateWalletsForUser(userId: string): Promise<void> {
    // TODO: implement wallet generation
    // Will generate Solana keypair + Polygon wallet,
    // encrypt both with AES-256-GCM using master key from secrets manager,
    // and write to user_wallets table.
    // NOT IMPLEMENTED YET — do not add logic here.
    this.logger.log(`Wallet generation pending for user ${userId}`);
  }
}
```

Call it from `AuthService` after any new user creation:

```typescript
// In AuthService, after creating a new user:
const user = await this.createUser(email, ...);
await this.walletService.generateWalletsForUser(user.id); // stub for now
```

---

### Environment variables to add

```
# Auth / JWT
JWT_SECRET=your-long-random-secret-here
JWT_EXPIRES_IN=7d

# Google OAuth
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...

# App domain (used for passkey rpID + magic link URLs)
APP_DOMAIN=alpatrix.io
APP_URL=https://alpatrix.io

# Email (for magic links) — choose one provider
RESEND_API_KEY=re_...
# or
SENDGRID_API_KEY=SG....

# Magic link
MAGIC_LINK_EXPIRY_MINUTES=15
```

---

## Key rules for Claude

- Always use `IVenueAdapter` interface — never call venue adapters directly from aggregation/execution
- New venue = new module in `src/venues/` implementing `IVenueAdapter`
- Bayse has both AMM and CLOB engines — always check `event.engine` before constructing order payload
- Bayse write requests require HMAC-SHA256 signing — implement in a shared `BayseAuthService`
- All data crossing the adapter boundary must be normalised to internal types
- Use NestJS `@Injectable()` providers, never instantiate services manually
- Bull queues for anything async or time-triggered (limit order checks, retry logic)
- Redis for all hot-path data (prices, order books) — never DB on the critical execution path
- Timestamp window on Bayse is 5 minutes — ensure server clock sync and handle `timestamp_expired` errors
- When in doubt about Polymarket signing details, check https://docs.polymarket.com before implementing
- Auth module lives in `src/auth/` — Google, passkey, and magic link all converge to the same JWT issuance
- Never store raw magic link tokens — only bcrypt hashes
- Passkey challenges stored in Redis with 5-minute TTL, deleted after use
- Always call `walletService.generateWalletsForUser()` after new user creation — currently a stub, do not implement yet
- JWT payload uses `sub` for user ID — always use `req.user.sub` to identify the caller in protected routes
- `WalletService` stub must exist and be wired in, but wallet logic must NOT be implemented until explicitly instructed