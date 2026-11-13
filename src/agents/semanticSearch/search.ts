import { query } from "../../db/connection.ts";
import { activeListingWhere, hasAnyFilter } from "../../db/listingFilters.ts";
import { EMBED_DIMS, EMBED_MODEL, embedQuery } from "../../embeddings/gemini.ts";
import { loadVectorIndex, type VectorIndex } from "../../embeddings/store.ts";
import { dotRow, topK } from "../../embeddings/vectorMath.ts";
import { parsePropertyQuery, type PropertyFilters } from "../propertySearch/parser.ts";

/**
 * Week 6 — semantic property search (library: no formatting, no session).
 * The agent wrapper lives in agent.ts.
 *
 *   "charming craftsman with mountain views and character"
 *     → embed the query (1 Gemini call)
 *     → cosine similarity against every stored listing vector (in memory)
 *     → top 5 active listings from rets_property
 *
 * Hybrid: hard constraints the Week 2 parser finds (city, max price, beds,
 * baths, sqft, type) narrow the candidates first; the embedding ranks what's
 * left. Pool/view are left to the embedding, since remarks describe them.
 */

export interface SemanticHit {
  L_ListingID: string;
  score: number; // cosine similarity, roughly 0–1
  L_Address: string;
  L_City: string;
  L_Zip: string | null;
  price: number;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  type: string | null;
  YearBuilt: number | null;
  DaysOnMarket: number | null;
  PhotoCount: number | null;
  L_Remarks: string | null;
}

export type HardFilters = Pick<PropertyFilters, "city" | "maxPrice" | "beds" | "baths" | "sqft" | "type" | "types">;

// ---------------------------------------------------------------------------
// Candidate filtering
// ---------------------------------------------------------------------------
let knownCities: Map<string, string> | null = null; // lower-case → canonical

async function canonicalCity(city: string | null): Promise<string | null> {
  if (!city) return null;
  if (!knownCities) {
    const rows = await query<{ L_City: string }>(
      "SELECT DISTINCT L_City FROM rets_property WHERE L_Status = 'Active' AND L_City IS NOT NULL",
    );
    knownCities = new Map(rows.map((r) => [String(r.L_City).toLowerCase(), String(r.L_City)]));
  }
  return knownCities.get(city.trim().toLowerCase()) ?? null;
}

/** IDs of active listings matching the hard filters (null = no filters). */
export async function candidateIds(f: HardFilters): Promise<Set<string> | null> {
  if (!hasAnyFilter(f)) return null;
  const { where, params } = activeListingWhere(f);
  const rows = await query<{ L_ListingID: string }>(`SELECT L_ListingID FROM rets_property WHERE ${where}`, params);
  return new Set(rows.map((r) => String(r.L_ListingID)));
}

// ---------------------------------------------------------------------------
// Vector search (reused by the Week 7 recommendation engine)
// ---------------------------------------------------------------------------
export function rankBySimilarity(
  index: VectorIndex,
  queryVec: Float32Array,
  k: number,
  candidates: Set<string> | null = null,
  exclude: Set<string> = new Set(),
): { id: string; score: number }[] {
  const scored = function* () {
    if (candidates) {
      for (const id of candidates) {
        const row = index.rowOf.get(id);
        if (row === undefined || exclude.has(id)) continue;
        yield { item: id, score: dotRow(queryVec, index.matrix, row, index.dims) };
      }
    } else {
      for (let row = 0; row < index.ids.length; row++) {
        const id = index.ids[row]!;
        if (exclude.has(id)) continue;
        yield { item: id, score: dotRow(queryVec, index.matrix, row, index.dims) };
      }
    }
  };
  return topK(scored(), k).map((x) => ({ id: x.item, score: x.score }));
}

export async function fetchListings(ids: string[]): Promise<Omit<SemanticHit, "score">[]> {
  if (ids.length === 0) return [];
  const rows = await query<Omit<SemanticHit, "score">>(
    `SELECT L_ListingID, L_Address, L_City, L_Zip, L_SystemPrice AS price,
            L_Keyword2 AS beds, LM_Dec_3 AS baths, LM_Int2_3 AS sqft, L_Type_ AS type,
            YearBuilt, DaysOnMarket, PhotoCount, L_Remarks
       FROM rets_property
      WHERE L_ListingID IN (${ids.map(() => "?").join(", ")})`,
    ids,
  );
  const byId = new Map(rows.map((r) => [String(r.L_ListingID), r]));
  return ids.map((id) => byId.get(id)).filter((r): r is Omit<SemanticHit, "score"> => Boolean(r));
}

export interface SemanticSearchResult {
  query: string;
  filters: HardFilters;
  results: SemanticHit[];
  indexed: number; // listings with embeddings
  candidates: number | null; // listings matching the hard filters (null = no filters)
  searched: number; // candidates that actually have embeddings
}

export async function semanticSearch(
  text: string,
  opts: { k?: number; fallbackCity?: string | null; hints?: Partial<HardFilters> } = {},
): Promise<SemanticSearchResult> {
  const k = opts.k ?? 5;
  // Structured hints from the caller (e.g. OpenClaw's model) override the regex parser.
  const parsed = { ...parsePropertyQuery(text) };
  for (const [key, v] of Object.entries(opts.hints ?? {})) {
    if (v !== null && v !== undefined) (parsed as Record<string, unknown>)[key] = v;
  }
  const filters: HardFilters = {
    city: (await canonicalCity(parsed.city)) ?? (await canonicalCity(opts.fallbackCity ?? null)),
    maxPrice: parsed.maxPrice,
    beds: parsed.beds,
    baths: parsed.baths,
    sqft: parsed.sqft,
    type: parsed.type,
    types: parsed.types ?? null,
  };

  const [index, candidates, queryVec] = await Promise.all([
    loadVectorIndex(EMBED_MODEL, EMBED_DIMS),
    candidateIds(filters),
    embedQuery(text.replace(/^semantic:\s*/i, "")),
  ]);

  const searched = candidates
    ? [...candidates].filter((id) => index.rowOf.has(id)).length
    : index.ids.length;
  const ranked = rankBySimilarity(index, queryVec, k, candidates);
  const details = await fetchListings(ranked.map((r) => r.id));
  const scoreOf = new Map(ranked.map((r) => [r.id, r.score]));

  return {
    query: text,
    filters,
    results: details.map((d) => ({ ...d, score: scoreOf.get(String(d.L_ListingID)) ?? 0 })),
    indexed: index.ids.length,
    candidates: candidates ? candidates.size : null,
    searched,
  };
}
