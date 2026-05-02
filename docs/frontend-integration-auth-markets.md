# Frontend Integration Guide: Auth + Markets

This document is a handoff for a frontend agent to integrate with the current backend.

Scope:
- Privy-based authentication integration
- Markets list/detail integration
- Required client services, types, and setup conventions

Base API URL:
- Set your frontend API base URL to your backend host, for example: `http://localhost:3000`

---

## 1) Auth Model (Current Backend Behavior)

The backend **does not** issue its own JWT anymore.  
Frontend authenticates users with Privy, then sends Privy access tokens to backend.

Backend auth guard behavior:
- Reads access token from:
  - `Authorization: Bearer <privy_access_token>` OR
  - `privy-token` cookie (if your frontend/backend are configured for cookie mode)
- Verifies Privy token (`iss`, `aud`, `exp`, signature)
- Maps Privy user DID (`sub`) to internal backend user row (`users.privyUserId`)
- Auto-creates user (and wallets) on first authenticated request

Important:
- In current backend, auth guard is global.
- There are no public routes annotated with `@Public()`.
- Assume all API routes require auth for now.

---

## 2) Frontend Auth Setup Checklist

1. Get access token from Privy SDK before API calls.
2. Attach token as `Authorization: Bearer <token>`.
3. On `401`, force token refresh via Privy and retry once.
4. Keep backend user profile in app state by calling `GET /auth/me` after login.

Suggested frontend env vars:
- `VITE_API_BASE_URL` (or your framework equivalent)
- `VITE_PRIVY_APP_ID`
- `VITE_PRIVY_CLIENT_ID`

---

## 3) Auth API Contract

### `GET /auth/me`

Headers:
- `Authorization: Bearer <privy_access_token>`

Success response (`200`):

```ts
export interface MeResponse {
  id: string; // internal backend user id (uuid)
  privyUserId: string; // Privy DID from token sub
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  solanaAddress: string | null;
  usdcTokenAddress: string | null;
}
```

Error responses:
- `401` if token is missing/invalid/expired

---

## 4) Markets API Contract

Controller base path: `/markets`

### `GET /markets`

Query params:
- `category?: string`
- `status?: 'open' | 'closed' | 'resolved'`
- `venueId?: 'polymarket' | 'bayse'`
- `page?: number` (default `1`)
- `size?: number` (default `20`)

Behavior:
- If `venueId` is provided: returns simple paginated results for that venue.
- If `venueId` is omitted: backend interleaves venues to avoid one venue dominating the page.
- If `status` is omitted: backend defaults to `'open'`.

Success response (`200`):

```ts
export interface MarketListResponse {
  data: MarketListItem[];
  total: number;
  page: number;
  size: number;
}

export interface MarketListItem {
  id: string; // internal market id
  matchGroupId: string | null;
  venueId: 'polymarket' | 'bayse' | string;
  venueMarketId: string;
  title: string;
  category: string;
  engine: string; // 'clob' | 'amm' | future values
  resolutionDate: string | null; // ISO date string
  status: 'open' | 'closed' | 'resolved' | string;
  volume24h: number;
  liquidity: number;
  rawData: Record<string, unknown>;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}
```

### `GET /markets/:id`

`id` supports:
- market group id (if matched group exists), OR
- individual market internal id, OR
- `venueMarketId`

Success response (`200`):

```ts
export interface MarketDetailResponse {
  event: {
    id: string;
    title: string;
    description: string | null;
    category: string;
    image: string | null;
    icon: string | null;
    endDate: string | null; // ISO date
    status: 'open' | 'closed' | 'resolved' | string;
  };
  brief: {
    volume: number;
    liquidity: number;
    marketProbability: number; // best YES price in cents (0-100)
  };
  venues: VenueMarketRow[];
}

export interface VenueMarketRow {
  venueId: 'polymarket' | 'bayse' | string;
  venueMarketId: string;
  yesPrice: number; // cents
  noPrice: number; // cents
  volume24h: number;
  liquidity: number;
}
```

Errors:
- `404` if no market/group found
- `401` for auth failures

### `POST /markets/sync`

Purpose:
- Triggers background fetch + upsert from integrated venues.

Response (`202`):

```ts
export interface TriggerSyncResponse {
  message: string;
}
```

Notes:
- This is fire-and-forget; UI should not wait for completion.
- Useful for admin/debug action, not for normal browsing UX.

---

## 5) Suggested Frontend Types (Single Source)

Create a shared types file, for example: `src/lib/api/types.ts`

```ts
export type VenueId = 'polymarket' | 'bayse' | string;
export type MarketStatus = 'open' | 'closed' | 'resolved' | string;

export interface MeResponse {
  id: string;
  privyUserId: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  solanaAddress: string | null;
  usdcTokenAddress: string | null;
}

export interface MarketListItem {
  id: string;
  matchGroupId: string | null;
  venueId: VenueId;
  venueMarketId: string;
  title: string;
  category: string;
  engine: string;
  resolutionDate: string | null;
  status: MarketStatus;
  volume24h: number;
  liquidity: number;
  rawData: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface MarketListResponse {
  data: MarketListItem[];
  total: number;
  page: number;
  size: number;
}

export interface VenueMarketRow {
  venueId: VenueId;
  venueMarketId: string;
  yesPrice: number;
  noPrice: number;
  volume24h: number;
  liquidity: number;
}

export interface MarketDetailResponse {
  event: {
    id: string;
    title: string;
    description: string | null;
    category: string;
    image: string | null;
    icon: string | null;
    endDate: string | null;
    status: MarketStatus;
  };
  brief: {
    volume: number;
    liquidity: number;
    marketProbability: number;
  };
  venues: VenueMarketRow[];
}
```

---

## 6) Suggested Frontend Service Layer

Create:
- `apiClient` with auth header injection
- `authService` for `getMe()`
- `marketsService` for list/detail/sync

Example contract design:

```ts
export interface MarketsQuery {
  category?: string;
  status?: 'open' | 'closed' | 'resolved';
  venueId?: 'polymarket' | 'bayse';
  page?: number;
  size?: number;
}

export interface AuthService {
  getMe(): Promise<MeResponse>;
}

export interface MarketsService {
  listMarkets(query?: MarketsQuery): Promise<MarketListResponse>;
  getMarket(id: string): Promise<MarketDetailResponse>;
  triggerSync(): Promise<{ message: string }>;
}
```

Implementation notes:
- Keep `listMarkets` query params optional and omit undefined values.
- Add `401` interceptor: refresh Privy access token and retry once.
- Normalize number/date rendering in UI, but keep raw API values in cache.

---

## 7) UI/State Recommendations

- On app boot after authenticated session:
  - call `GET /auth/me`
  - store internal `id` and wallet addresses for later wallet actions
- Markets list page:
  - default query `{ page: 1, size: 20 }` (status omitted -> open by backend default)
  - add filters for `category`, `venueId`, `status`
- Market detail page:
  - fetch by route id using `GET /markets/:id`
  - show `brief.marketProbability` as percent (`marketProbability / 100`)
  - show per-venue rows from `venues[]`

---

## 8) Error Handling Matrix

- `401 Unauthorized`
  - likely expired/invalid/missing Privy token
  - refresh token and retry once; if still failing, sign user out
- `404 Not Found` on market detail
  - show unavailable/not-found state
- network/timeouts
  - show retry CTA and preserve last successful cache

---

## 9) Quick Integration Definition of Done

- [ ] Privy token attached to all backend API requests
- [ ] `authService.getMe()` wired and typed
- [ ] markets list and detail services implemented with types above
- [ ] `401` refresh-and-retry behavior implemented
- [ ] basic UI states: loading, empty, error, not found
- [ ] query param filters + pagination working on markets list

