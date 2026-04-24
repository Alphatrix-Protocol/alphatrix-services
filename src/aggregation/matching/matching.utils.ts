/**
 * Bigram-based Sørensen–Dice coefficient.
 * Better than Levenshtein for prediction market titles because
 * word order matters less than shared word fragments.
 */
export function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const aGrams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const gram = a.slice(i, i + 2);
    aGrams.set(gram, (aGrams.get(gram) ?? 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const gram = b.slice(i, i + 2);
    const count = aGrams.get(gram) ?? 0;
    if (count > 0) {
      intersection++;
      aGrams.set(gram, count - 1);
    }
  }

  return (2 * intersection) / (a.length - 1 + (b.length - 1));
}

const STOP_WORDS = /\b(will|the|a|an|by|in|on|for|to|of|be|is|are|was|were|has|have|had|do|does|did|can|could|would|should|may|might|that|this|it|its)\b/g;

export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(STOP_WORDS, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Returns 0–1 based on how close two resolution dates are.
 * Returns 0.5 (neutral) if either date is missing — we don't
 * penalise markets that have one date missing.
 */
export function dateProximity(a: Date | null, b: Date | null): number {
  if (!a || !b) return 0.5;
  const diffDays = Math.abs(a.getTime() - b.getTime()) / 86_400_000;
  if (diffDays === 0) return 1;
  if (diffDays <= 1) return 0.9;
  if (diffDays <= 7) return 0.7;
  if (diffDays <= 30) return 0.4;
  return 0;
}

export interface MarketLike {
  title: string;
  category: string;
  resolutionDate: Date | null;
}

export function scoreMarketPair(a: MarketLike, b: MarketLike): number {
  const titleScore = diceCoefficient(normaliseTitle(a.title), normaliseTitle(b.title));
  const categoryScore = a.category === b.category ? 1 : 0;
  const dateScore = dateProximity(a.resolutionDate, b.resolutionDate);
  return titleScore * 0.6 + categoryScore * 0.2 + dateScore * 0.2;
}
