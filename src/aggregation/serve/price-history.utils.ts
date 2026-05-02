export interface OhlcCandle {
  time: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface LinePoint {
  time: string; // YYYY-MM-DD
  value: number;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function bucketKey(ts: number, bucketMs: number): string {
  return formatDate(new Date(Math.floor(ts / bucketMs) * bucketMs));
}

export function toCandles(
  points: { time: Date; price: number }[],
  bucketMs: number,
): OhlcCandle[] {
  if (points.length === 0) return [];

  const sorted = [...points].sort((a, b) => a.time.getTime() - b.time.getTime());
  const buckets = new Map<string, number[]>();

  for (const p of sorted) {
    const key = bucketKey(p.time.getTime(), bucketMs);
    const bucket = buckets.get(key) ?? [];
    bucket.push(Math.round(p.price * 100));
    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, prices]) => ({
      time,
      open: prices[0],
      high: Math.max(...prices),
      low: Math.min(...prices),
      close: prices[prices.length - 1],
    }));
}

export function toLine(
  points: { time: Date; price: number }[],
  bucketMs: number,
): LinePoint[] {
  if (points.length === 0) return [];

  const sorted = [...points].sort((a, b) => a.time.getTime() - b.time.getTime());
  const buckets = new Map<string, number>();

  for (const p of sorted) {
    const key = bucketKey(p.time.getTime(), bucketMs);
    // Last write wins → close price for the bucket
    buckets.set(key, Math.round(p.price * 100));
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, value]) => ({ time, value }));
}

export function rangeToBucketMs(range: string): number {
  const hour = 3_600_000;
  const day = 86_400_000;
  switch (range) {
    case '1W': return hour;       // hourly buckets
    case '1M': return day;        // daily
    case '3M': return day;        // daily
    default:   return day * 7;    // weekly for 'all'
  }
}
