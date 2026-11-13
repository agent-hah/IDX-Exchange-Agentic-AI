import type { MarketFilters } from "./queries.ts";

/**
 * Week 5 — parse free-text market questions into MarketFilters.
 *   "Is now a good time to buy in San Diego?"           -> { city: "San Diego", months: 12 }
 *   "Average price per sq ft for condos in Pasadena"    -> { city: "Pasadena", subType: "Condominium" }
 *   "How has 92618 done over the last 2 years?"         -> { zip: "92618", months: 24 }
 */

const MARKET_KEYWORDS =
  /\b(market|markets|trends?|trending|median|average|avg|price per (?:sq\.? ?ft|square (?:foot|feet))|ppsf|\$\/sq ?ft|days on market|dom|list[- ]to[- ](?:close|sale)|sale[- ]to[- ]list|good time to (?:buy|sell)|apprecia\w*|rising|falling|going (?:up|down)|comps?|sold|closed sales|inventory|months of supply|yoy|year[- ]over[- ]year|month[- ]over[- ]month|prices?\s+(?:up|down|rising|falling|trend\w*|change\w*))\b/i;

export function isMarketQuestion(text: string): boolean {
  return MARKET_KEYWORDS.test(text);
}

// Words that can follow "in/for <X>" but are never a city, and words that end
// a city name when they appear after it.
const NOT_A_CITY = new Set([
  "the", "a", "an", "this", "that", "now", "general", "california", "ca",
  "last", "past", "recent", "today", "2021", "2022", "2023", "2024", "2025",
  "buyers", "sellers", "me", "us",
  "condo", "condos", "condominiums", "townhome", "townhomes", "townhouse",
  "townhouses", "home", "homes", "house", "houses", "single", "sfr",
  "residential", "properties", "listings",
]);
const CITY_TERMINATORS =
  "over|during|for|in|last|past|this|compared|vs|versus|right|now|since|from|and|under|with|condos?|townhomes?|townhouses?|homes?|houses?|single|market|real|prices?|sales|lately|recently|ca|california";

const CITY_AFTER_PREP = new RegExp(
  String.raw`\b(?:in|for|around|near|within)\s+([A-Za-z][A-Za-z.'\- ]*?)(?=\s*(?:[?.!,;:]|$|\s+(?:${CITY_TERMINATORS})\b))`,
  "gi",
);
// "the Irvine market", "Pasadena home prices"
const CITY_BEFORE_NOUN =
  /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\s+(?:market|housing|real estate|home prices|condo market|prices)\b/;

const SUBTYPES: [RegExp, string][] = [
  [/\bcondos?\b|\bcondominiums?\b/i, "Condominium"],
  [/\btown ?homes?\b|\btown ?houses?\b/i, "Townhouse"],
  [/\bsingle[- ]family\b|\bsfr\b/i, "SingleFamilyResidence"],
];

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export function extractCity(text: string): string | null {
  for (const m of text.matchAll(CITY_AFTER_PREP)) {
    let cand = (m[1] ?? "").trim().replace(/^the\s+/i, "");
    if (!cand) continue;
    if (NOT_A_CITY.has(cand.toLowerCase())) continue;
    if (/^(?:the|a|an)\b/i.test(cand)) continue;
    return titleCase(cand);
  }
  const before = text.match(CITY_BEFORE_NOUN);
  if (before?.[1]) {
    const cand = before[1].replace(/^(?:The|How|What|Is|Are|Show|Give)\s+/, "");
    const first = cand.split(" ")[0]?.toLowerCase() ?? "";
    if (cand && !NOT_A_CITY.has(first) && !/^(?:How|What|Is|Are)$/.test(cand)) {
      return titleCase(cand);
    }
  }
  return null;
}

export function extractMonths(text: string): number {
  const t = text.toLowerCase();
  let months = 12;
  let m: RegExpMatchArray | null;
  if ((m = t.match(/(?:last|past|previous)\s+(\d+)\s+months?/))) months = Number(m[1]);
  else if ((m = t.match(/(?:last|past|previous)\s+(\d+)\s+years?/))) months = Number(m[1]) * 12;
  else if ((m = t.match(/\b(\d+)[- ]months?\b/))) months = Number(m[1]);
  else if ((m = t.match(/\b(\d+)[- ]years?\b/))) months = Number(m[1]) * 12;
  else if (/(?:last|past)\s+(?:quarter|3 months)/.test(t)) months = 3;
  else if (/(?:last|past)\s+(?:six|half(?:\s+a)?)\s+(?:months|year)/.test(t)) months = 6;
  else if (/(?:last|past)\s+two\s+years/.test(t)) months = 24;
  return Math.max(1, Math.min(48, months));
}

export function parseMarketQuery(text: string): MarketFilters {
  const zip = text.match(/\b(9[0-6]\d{3})\b/)?.[1] ?? null;
  const subType = SUBTYPES.find(([re]) => re.test(text))?.[1] ?? null;
  return {
    city: extractCity(text),
    zip,
    subType,
    months: extractMonths(text),
  };
}
