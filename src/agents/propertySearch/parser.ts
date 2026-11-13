/**
 * Week 2 — parse free-text property requests into structured filters.
 *   "Show me 3-bedroom condos in Irvine under $1.5M with a pool"
 *     → { city: "Irvine", maxPrice: 1500000, beds: 3, type: "Condominium", pool: "True", ... }
 */

export interface PropertyFilters {
  city: string | null;
  maxPrice: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  type: string | null;
  /** Set only when the request names more than one type ("condos and townhomes"). */
  types?: string[] | null;
  pool: string | null;
  hasView: string | null;
}

const CITY_PATTERN = /in ([A-Za-z\s]+?)(?:\s+under|\s+with|\s+at|$)/;

/** City after "in" (e.g. "... in Irvine under $1M"). Also used by the semantic router. */
export function extractCity(text: string): string | null {
  return text.match(CITY_PATTERN)?.[1]?.trim() || null;
}

// Whole words only: a plain substring match turned "Oakland" into vacant land.
const TYPE_PATTERNS: [RegExp, string][] = [
  [/\bcondo(minium)?s?\b/i, "Condominium"],
  [/\btown ?(home|house)s?\b/i, "Townhouse"],
  [/\bsingle[- ]family\b/i, "SingleFamilyResidence"],
  [/\bland\b/i, "Unimproved Land"],
];

/** Property types mentioned in the text, in the order of TYPE_PATTERNS. */
export function extractTypes(text: string): string[] {
  return TYPE_PATTERNS.filter(([re]) => re.test(text)).map(([, t]) => t);
}

export function parsePropertyQuery(query: string): PropertyFilters {
  const priceMatch = query.match(/(?:under|budget|max).*?\$?([\d,.]+)[\s]*(k|m)?/i);
  const bedsMatch = query.match(/(\d+)[\s-]*(bed|beds|bedroom|bedrooms)/i);
  const bathsMatch = query.match(/(\d+(?:\.5)?)[\s-]*(bath|baths|bathroom|bathrooms)/i);
  const sqftMatch = query.match(/(\d+)[\s-]*(sqft|sq ft|square feet|square foot)/i);
  const types = extractTypes(query);

  let maxPrice: number | null = null;
  if (priceMatch) {
    maxPrice = Number((priceMatch[1] ?? "").replace(/,/g, ""));
    if (priceMatch[2]?.toLowerCase() === "k") maxPrice *= 1000;
    if (priceMatch[2]?.toLowerCase() === "m") maxPrice *= 1000000;
  }

  const filters: PropertyFilters = {
    city: extractCity(query),
    maxPrice,
    beds: bedsMatch ? Number(bedsMatch[1]) : null,
    baths: bathsMatch ? Number(bathsMatch[1]) : null,
    sqft: sqftMatch ? Number(sqftMatch[1]) : null,
    type: types[0] ?? null,
    pool: /pool/i.test(query) ? "True" : null,
    hasView: /view/i.test(query) ? "True" : null,
  };
  if (types.length > 1) filters.types = types;
  return filters;
}
