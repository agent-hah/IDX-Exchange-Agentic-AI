import { query } from "../db/connection.ts";
import { EMBED_DIMS, EMBED_MODEL, embedQuery } from "../embeddings/gemini.ts";
import { dotRow, topK } from "../embeddings/vectorMath.ts";
import { loadVectorIndex, type VectorIndex } from "../embeddings/store.ts";
import { getSession, updateSession } from "../memory/session.ts";
import { parsePropertyQuery, type PropertyFilters } from "./propertySearch.ts";

/**
 * Week 6 — semantic property search.
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

type HardFilters = Pick<PropertyFilters, "city" | "maxPrice" | "beds" | "baths" | "sqft" | "type">;

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

function hasHardFilters(f: HardFilters) {
  return Boolean(f.city || f.maxPrice || f.beds || f.baths || f.sqft || f.type);
}

/** IDs of active listings matching the hard filters (null = no filters). */
export async function candidateIds(f: HardFilters): Promise<Set<string> | null> {
  if (!hasHardFilters(f)) return null;
  let sql = "SELECT L_ListingID FROM rets_property WHERE L_Status = 'Active'";
  const params: (string | number)[] = [];
  if (f.city) { sql += " AND L_City = ?"; params.push(f.city); }
  if (f.maxPrice) { sql += " AND L_SystemPrice <= ?"; params.push(f.maxPrice); }
  if (f.beds) { sql += " AND L_Keyword2 >= ?"; params.push(f.beds); }
  if (f.baths) { sql += " AND LM_Dec_3 >= ?"; params.push(f.baths); }
  if (f.sqft) { sql += " AND LM_Int2_3 >= ?"; params.push(f.sqft); }
  if (f.type) { sql += " AND L_Type_ = ?"; params.push(f.type); }
  const rows = await query<{ L_ListingID: string }>(sql, params);
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
  opts: { k?: number; fallbackCity?: string | null } = {},
): Promise<SemanticSearchResult> {
  const k = opts.k ?? 5;
  const parsed = await parsePropertyQuery(text);
  const filters: HardFilters = {
    city: (await canonicalCity(parsed.city)) ?? (await canonicalCity(opts.fallbackCity ?? null)),
    maxPrice: parsed.maxPrice,
    beds: parsed.beds,
    baths: parsed.baths,
    sqft: parsed.sqft,
    type: parsed.type,
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

// ---------------------------------------------------------------------------
// Agent + WhatsApp formatting
// ---------------------------------------------------------------------------
function snippet(remarks: string | null, max = 160): string {
  const s = (remarks ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  return s.length <= max ? s : `${s.slice(0, s.lastIndexOf(" ", max)).trim()}…`;
}

function describeFilters(f: HardFilters): string {
  const parts = [
    f.city,
    f.type,
    f.maxPrice ? `≤ $${f.maxPrice.toLocaleString("en-US")}` : null,
    f.beds ? `${f.beds}+ beds` : null,
    f.baths ? `${f.baths}+ baths` : null,
    f.sqft ? `${f.sqft.toLocaleString("en-US")}+ sqft` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

export function formatSemanticResults(r: SemanticSearchResult): string {
  const lines: string[] = [`🔎 *Top ${r.results.length} matches* for “${r.query.replace(/^semantic:\s*/i, "")}”`];
  const filt = describeFilters(r.filters);
  if (filt) lines.push(`_Filtered to: ${filt}_`);
  lines.push("");
  r.results.forEach((h, i) => {
    const specs = [
      `$${Number(h.price).toLocaleString("en-US")}`,
      `${h.beds ?? "?"}bd/${h.baths !== null ? Number(h.baths) : "?"}ba`,
      h.sqft ? `${Number(h.sqft).toLocaleString("en-US")} sqft` : null,
      h.PhotoCount ? `📸 ${h.PhotoCount}` : null,
    ].filter(Boolean);
    lines.push(`${i + 1}. *${h.L_Address}, ${h.L_City}* · similarity ${h.score.toFixed(2)}`);
    lines.push(`   ${specs.join(" | ")}`);
    const s = snippet(h.L_Remarks);
    if (s) lines.push(`   _${s}_`);
    lines.push("");
  });
  if (r.searched < (r.candidates ?? r.indexed) || r.indexed === 0) {
    lines.push(`_Searched ${r.searched.toLocaleString()} embedded listings (indexing incomplete)._`);
  }
  return lines.join("\n").trim();
}

export async function semanticSearchAgent(message: string, userId?: string) {
  try {
    const session = userId ? getSession(userId) : null;
    const result = await semanticSearch(message, { k: 5, fallbackCity: session?.city ?? null });

    if (result.indexed === 0) {
      return {
        status: "not_ready",
        intent: "semantic_search",
        response: "Semantic search isn't set up yet: no listing embeddings found. Run `npm run embed:listings` first.",
      };
    }
    if (result.results.length === 0) {
      const where = describeFilters(result.filters);
      const hint =
        result.candidates && result.searched === 0
          ? ` None of the ${result.candidates.toLocaleString()} matching listings are embedded yet${result.filters.city ? ` (run \`npm run embed:listings -- --city "${result.filters.city}"\`)` : ""}.`
          : "";
      return {
        status: "empty",
        intent: "semantic_search",
        data: result,
        response: `I couldn't find active listings matching that${where ? ` (${where})` : ""}.${hint} Try loosening the price or bedroom limits.`,
      };
    }

    if (userId) {
      updateSession(userId, {
        lastResults: result.results,
        ...(result.filters.city ? { city: result.filters.city } : {}),
      });
    }
    return {
      status: "success",
      intent: "semantic_search",
      data: result,
      response: formatSemanticResults(result),
    };
  } catch (error) {
    console.error("Semantic Search Skill Error:", error);
    return {
      status: "error",
      intent: "semantic_search",
      response: "Sorry, I hit an issue running the semantic search. Please try again.",
    };
  }
}
