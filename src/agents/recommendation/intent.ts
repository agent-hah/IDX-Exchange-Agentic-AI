/**
 * Week 7 — recognize "find me more like that one" and work out which listing
 * "that one" is. Pure functions (no database).
 */

interface ShownListing {
  L_ListingID: string;
  L_Address: string;
}

const ORDINALS: Record<string, number> = {
  first: 1,
  "1st": 1,
  second: 2,
  "2nd": 2,
  third: 3,
  "3rd": 3,
  fourth: 4,
  "4th": 4,
  fifth: 5,
  "5th": 5,
};

const SIMILAR =
  /\b(similar|comparable|more like|homes like|listings like|places like|alternatives?|recommend)\b/i;
const REFERENCE =
  /#\s?\d\b|\b(number|no\.?)\s?\d\b|\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|last)\b|\b(this|that|it)\b(?!\s+(has|is|was))/i;
// A street address: number + capitalized street word ("59 Fox Hollow"), not "3 bedroom".
export const ADDRESS =
  /\b(\d{1,6}\s+(?!Bed|Bath)[A-Z][A-Za-z.'\-]*(?:\s+[A-Z#][A-Za-z0-9.'\-]*)*)/;

/**
 * True for "more like #2", "similar to the second one", "homes like 59 Fox Hollow".
 * False for "something similar to a mid-century ranch" (a description → semantic search).
 */
export function isRecommendationQuery(text: string): boolean {
  return SIMILAR.test(text) && (REFERENCE.test(text) || ADDRESS.test(text));
}

/** Position the user referred to: "#2", "number 2", "the second one", "the last one". */
export function referencedPosition(text: string, count: number): number | null {
  const hash = text.match(/#\s?(\d)\b|\b(?:number|no\.?)\s?(\d)\b/i);
  if (hash) return Number(hash[1] ?? hash[2]);
  const ord = text
    .toLowerCase()
    .match(/\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|last)\b/);
  if (ord) return ord[1] === "last" ? count : (ORDINALS[ord[1]!] ?? null);
  return null;
}

/**
 * Which listing from the last results the user means, as a listing id.
 * Order: explicit position hint → address mentioned → "#2"/"second" in the text
 * → "this/that/it" when only one listing was shown.
 */
export function resolveListingReference(
  text: string,
  shown: ShownListing[],
  hints: { resultNumber?: number; address?: string } = {},
): string | null {
  if (shown.length === 0) return null;
  const at = (n: number | null | undefined) =>
    n && n >= 1 && n <= shown.length ? String(shown[n - 1]!.L_ListingID) : null;

  const byHint = at(hints.resultNumber);
  if (byHint) return byHint;

  const needle = (hints.address ?? text).toLowerCase();
  const byAddress = shown.find(
    (l) => l.L_Address && needle.includes(l.L_Address.toLowerCase()),
  );
  if (byAddress) return String(byAddress.L_ListingID);

  const byPosition = at(referencedPosition(text, shown.length));
  if (byPosition) return byPosition;

  if (shown.length === 1 && /\b(this|that|it)\b/i.test(text))
    return String(shown[0]!.L_ListingID);
  return null;
}
