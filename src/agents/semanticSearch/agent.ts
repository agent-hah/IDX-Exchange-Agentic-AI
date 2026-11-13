import { getSession, updateSession } from "../../memory/session.ts";
import type { AgentResult } from "../../types.ts";
import { fmtInt, fmtPrice } from "../../utils/format.ts";
import { semanticSearch, type HardFilters, type SemanticSearchResult } from "./search.ts";

/**
 * Week 6 — semantic search agent: runs the search, formats WhatsApp cards,
 * and stores the results in the session for the Week 7 recommendation engine.
 */

function snippet(remarks: string | null, max = 160): string {
  const s = (remarks ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  return s.length <= max ? s : `${s.slice(0, s.lastIndexOf(" ", max)).trim()}…`;
}

function describeFilters(f: HardFilters): string {
  const parts = [
    f.city,
    f.type,
    f.maxPrice ? `≤ ${fmtPrice(f.maxPrice)}` : null,
    f.beds ? `${f.beds}+ beds` : null,
    f.baths ? `${f.baths}+ baths` : null,
    f.sqft ? `${fmtInt(f.sqft)}+ sqft` : null,
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
      fmtPrice(h.price),
      `${h.beds ?? "?"}bd/${h.baths !== null ? Number(h.baths) : "?"}ba`,
      h.sqft ? `${fmtInt(h.sqft)} sqft` : null,
      h.PhotoCount ? `📸 ${h.PhotoCount}` : null,
    ].filter(Boolean);
    lines.push(`${i + 1}. *${h.L_Address}, ${h.L_City}* · similarity ${h.score.toFixed(2)}`);
    lines.push(`   ${specs.join(" | ")}`);
    const s = snippet(h.L_Remarks);
    if (s) lines.push(`   _${s}_`);
    lines.push("");
  });
  if (r.searched < (r.candidates ?? r.indexed) || r.indexed === 0) {
    lines.push(`_Searched ${fmtInt(r.searched)} embedded listings (indexing incomplete)._`);
  }
  return lines.join("\n").trim();
}

export async function semanticSearchAgent(message: string, userId?: string): Promise<AgentResult<SemanticSearchResult>> {
  try {
    const session = userId ? getSession(userId) : null;
    const result = await semanticSearch(message, { k: 5, fallbackCity: session?.city ?? null });

    if (result.indexed === 0) {
      return {
        status: "not_ready" as const,
        intent: "semantic_search" as const,
        response: "Semantic search isn't set up yet: no listing embeddings found. Run `npm run embed:listings` first.",
      };
    }
    if (result.results.length === 0) {
      const where = describeFilters(result.filters);
      const hint =
        result.candidates && result.searched === 0
          ? ` None of the ${fmtInt(result.candidates)} matching listings are embedded yet${result.filters.city ? ` (run \`npm run embed:listings -- --city "${result.filters.city}"\`)` : ""}.`
          : "";
      return {
        status: "empty" as const,
        intent: "semantic_search" as const,
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
      status: "success" as const,
      intent: "semantic_search" as const,
      data: result,
      response: formatSemanticResults(result),
    };
  } catch (error) {
    console.error("Semantic Search Skill Error:", error);
    return {
      status: "error" as const,
      intent: "semantic_search" as const,
      response: "Sorry, I hit an issue running the semantic search. Please try again.",
    };
  }
}
