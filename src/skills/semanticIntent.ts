/**
 * Week 6 — decide whether a message is a descriptive (semantic) search.
 *
 * Heuristic until the Week 9 orchestrator: strip everything the structured
 * parser understands (city, price, beds/baths, sqft, type, pool, view) plus
 * filler words. If at least two descriptive words are left ("charming",
 * "craftsman", "backyard"...), the message needs semantic search; otherwise
 * the structured Week 2–4 search handles it fine.
 */

const FILLER = new Set(
  `find show me give get looking look searching search for want wanted need needs would like i im i'm id i'd
   a an the some any with without and or in at near around on of to from that which has have having is are be
   been was place places home homes house houses property properties listing listings something somewhere
   please can you could should what whats what's where there here also just only really very
   under over below above less more than max maximum min minimum budget price priced cost costs about between up
   k m mil million millions thousand dollars usd
   bed beds bedroom bedrooms br bath baths bathroom bathrooms ba sqft sq ft square feet foot
   condo condos condominium condominiums townhome townhomes townhouse townhouses single family residence sfr land
   pool pools view views least most my our we us it its this these those one ones
   ca california available listed sale buy buying rent`.split(/\s+/),
);

const EXPLICIT = /\b(similar to|vibe|aesthetic|reminds? me of|describe[ds]?)\b|^semantic:/i;

export function descriptiveWords(text: string): string[] {
  const t = text.replace(/^semantic:\s*/i, "");
  const city = (parsePropertyQueryCity(t) ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return t
    .toLowerCase()
    .replace(/\$?\d[\d,.]*\s*(k|m|mm)?\b/g, " ") // prices, counts, sqft numbers
    .replace(/[^a-z'\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w.length >= 3 && !FILLER.has(w) && !city.includes(w));
}

/** Same city pattern as propertySearch.parsePropertyQuery (kept synchronous here). */
function parsePropertyQueryCity(text: string): string | null {
  const m = text.match(/in ([A-Za-z\s]+?)(?:\s+under|\s+with|\s+at|$)/);
  return m?.[1]?.trim() ?? null;
}

export function isSemanticQuery(text: string): boolean {
  if (EXPLICIT.test(text)) return true;
  return descriptiveWords(text).length >= 2;
}
