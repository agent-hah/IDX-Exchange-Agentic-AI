/**
 * Week 7 — hybrid similarity score (0–100), as specified in the handbook:
 *   structured (max 60): price 20 · bedrooms 15 · city 15 · size 10
 *   semantic   (max 40): cosine similarity of the listing embeddings × 40
 */

export interface Comparable {
  price: number;
  beds: number | null;
  city: string;
  sqft: number | null;
}

export interface ScoreBreakdown {
  price: number;
  beds: number;
  city: number;
  sqft: number;
  semantic: number;
  total: number;
}

export function priceScore(a: number, b: number): number {
  const diff = Math.abs(a - b);
  if (diff < 50_000) return 20;
  if (diff < 150_000) return 12;
  if (diff < 300_000) return 5;

  return 0;
}

export function sqftScore(a: number | null, b: number | null): number {
  if (!a || !b) return 0; // zero is a neutral value, and we can't give points if both are undefiend
  const diff = Math.abs(a - b);
  if (diff < 300) return 10;
  if (diff < 700) return 5;

  return 0;
}

/**
 * @param semanticSim cosine similarity of the two listings' embeddings, or null
 *   if either listing isn't embedded yet (then semantic contributes 0)
 */
export function similarityScore(
  target: Comparable,
  candidate: Comparable,
  semanticSim: number | null,
): ScoreBreakdown {
  const price = priceScore(target.price, candidate.price);
  const beds =
    target.beds != null && Number(target.beds) === Number(candidate.beds)
      ? 15
      : 0;
  const city =
    target.city.trim().toLowerCase() === candidate.city.trim().toLowerCase()
      ? 15
      : 0;
  const sqft = sqftScore(
    target.sqft === null ? null : Number(target.sqft),
    candidate.sqft === null ? null : Number(candidate.sqft),
  );
  const semantic =
    semanticSim === null ? 0 : Math.max(0, Math.min(1, semanticSim)) * 40;
  const total = Math.round((price + beds + city + sqft + semantic) * 100) / 100;
  return {
    price,
    beds,
    city,
    sqft,
    semantic: Math.round(semantic * 100) / 100,
    total,
  };
}
