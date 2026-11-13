import { EMBED_DIMS, EMBED_MODEL } from "../../embeddings/gemini.ts";
import { getVector, loadVectorIndex } from "../../embeddings/store.ts";
import { cosine } from "../../embeddings/vectorMath.ts";
import { getSession, updateSession } from "../../memory/session.ts";
import type { AgentResult } from "../../types.ts";
import {
  fmtDate,
  fmtInt,
  fmtMoney,
  fmtPrice,
  typeLabel,
} from "../../utils/format.ts";
import { getAnchorDate, shiftMonths } from "../marketStats/queries.ts";
import { ADDRESS, resolveListingReference } from "./intent.ts";
import {
  findListingByAddress,
  getCandidates,
  getListing,
  validateWithComps,
  type CompCheck,
  type ListingSummary,
} from "./queries.ts";
import {
  similarityScore,
  type Comparable,
  type ScoreBreakdown,
} from "./scoring.ts";

/**
 * Week 7 — recommendation agent.
 *   "more like #2" / "similar to 59 Fox Hollow"
 *     1. work out which listing the user means (session results, an id, or an address)
 *     2. gather candidates: active listings within $300K, same city first
 *     3. score each with the hybrid model (scoring.ts)
 *     4. check the top 5 against recent sold comps (queries.ts)
 */

export interface RecommendHints {
  listingId?: string;
  address?: string;
  resultNumber?: number; // 1-based position in the last list shown to the user
}

export interface Recommendation {
  listing: ListingSummary;
  score: ScoreBreakdown;
  comps: CompCheck;
}

export interface RecommendationResult {
  target: ListingSummary;
  recommendations: Recommendation[];
  semanticAvailable: boolean; // false if the target listing isn't embedded yet
  compWindow: { start: string; end: string };
}

const MIN_COMPS = 3;

/** Database row → the four fields the scoring model compares. */
const asComparable = (l: ListingSummary): Comparable => ({
  price: Number(l.price),
  beds: l.beds === null ? null : Number(l.beds),
  city: String(l.L_City ?? ""),
  sqft: l.sqft === null ? null : Number(l.sqft),
});

export function compVerdict(c: CompCheck): string {
  if (c.compCount < MIN_COMPS || c.deltaPct === null || c.compPrice === null) {
    return `too few comparable sales to judge (${c.compCount})`;
  }
  const where =
    c.deltaPct <= -5
      ? `${Math.abs(c.deltaPct)}% below comps`
      : c.deltaPct >= 5
        ? `${c.deltaPct}% above comps`
        : "in line with comps";
  return `comps ~${fmtMoney(c.compPrice)} (${c.compCount} sales, ${fmtMoney(c.avgPpsf)}/sqft) → ${where}`;
}

function specs(l: ListingSummary): string {
  return [
    fmtPrice(l.price),
    `${l.beds ?? "?"}bd/${l.baths !== null ? Number(l.baths) : "?"}ba`,
    l.sqft ? `${fmtInt(l.sqft)} sqft` : null,
    l.type ? typeLabel(l.type) : null,
  ]
    .filter(Boolean)
    .join(" | ");
}

export function formatRecommendations(
  r: RecommendationResult,
  windowLabel: string,
): string {
  const lines = [
    `🏡 *Listings similar to ${r.target.L_Address}, ${r.target.L_City}*`,
    `_${specs(r.target)}_`,
    "",
  ];
  r.recommendations.forEach(({ listing, score, comps }, i) => {
    lines.push(
      `${i + 1}. *${listing.L_Address}, ${listing.L_City}* · match ${Math.round(score.total)}/100`,
    );
    lines.push(`   ${specs(listing)}`);
    lines.push(`   💲 ${compVerdict(comps)}`);
    lines.push("");
  });
  lines.push(
    `_Match = price, beds, city & size (60 pts) + description similarity (40 pts)` +
      `${r.semanticAvailable ? "" : ", but this listing isn't embedded yet, so description similarity wasn't used"}. ` +
      `Comps: residential sales in the same city within ±20% of the size, ${windowLabel}._`,
  );
  return lines.join("\n");
}

async function resolveTarget(
  message: string,
  userId: string,
  hints: RecommendHints,
): Promise<ListingSummary | null> {
  if (hints.listingId) return getListing(hints.listingId);
  const shown = (getSession(userId).lastResults ?? []) as ListingSummary[];
  const fromSession = resolveListingReference(message, shown, hints);
  if (fromSession) return getListing(fromSession);
  const address = hints.address ?? message.match(ADDRESS)?.[1];
  return address
    ? findListingByAddress(address, getSession(userId).city ?? null)
    : null;
}

export async function recommendationAgent(
  message: string,
  userId: string,
  hints: RecommendHints = {},
): Promise<AgentResult<RecommendationResult>> {
  const intent = "recommendation";
  try {
    const target = await resolveTarget(message, userId, hints);
    if (!target) {
      return {
        status: "needs_input",
        intent,
        response:
          'Which listing should I find similar homes for? Search first and say e.g. "more like #2", or give me its address.',
      };
    }

    // Candidates: same city first; widen to any city if that leaves fewer than 5.
    let candidates = await getCandidates(target, { sameCity: true });
    if (candidates.length < 5) {
      const seen = new Set(candidates.map((c) => c.L_ListingID));
      candidates = candidates.concat(
        (await getCandidates(target, { sameCity: false })).filter(
          (c) => !seen.has(c.L_ListingID),
        ),
      );
    }

    // Semantic part: compare stored listing embeddings (Week 6). If the target isn't
    // embedded yet, score on structure only. If it is, prefer embedded candidates so
    // un-embedded ones aren't unfairly ranked on 60 points instead of 100.
    const index = await loadVectorIndex(EMBED_MODEL, EMBED_DIMS);
    const targetVec = getVector(index, String(target.L_ListingID));
    if (targetVec) {
      const embedded = candidates.filter((c) =>
        index.rowOf.has(String(c.L_ListingID)),
      );
      if (embedded.length >= 5) candidates = embedded;
    }

    const scored = candidates
      .map((c) => {
        const vec = targetVec ? getVector(index, String(c.L_ListingID)) : null;
        const sim = targetVec && vec ? cosine(targetVec, vec) : null;
        return {
          listing: c,
          score: similarityScore(asComparable(target), asComparable(c), sim),
        };
      })
      .sort((a, b) => b.score.total - a.score.total)
      .slice(0, 5);

    if (scored.length === 0) {
      return {
        status: "empty",
        intent,
        response: `I couldn't find other active listings near ${fmtPrice(target.price)} to compare with ${target.L_Address}.`,
      };
    }

    const recommendations: Recommendation[] = await Promise.all(
      scored.map(async (s) => ({
        ...s,
        comps: await validateWithComps(
          s.listing.L_City,
          s.listing.sqft,
          Number(s.listing.price),
        ),
      })),
    );
    const end = await getAnchorDate();
    const result: RecommendationResult = {
      target,
      recommendations,
      semanticAvailable: Boolean(targetVec),
      compWindow: { start: shiftMonths(end, -6), end },
    };

    // So "more like #3" works on these results next.
    updateSession(userId, {
      lastResults: recommendations.map((r) => r.listing),
    });
    return {
      status: "success",
      intent,
      data: result,
      response: formatRecommendations(
        result,
        `6 months ending ${fmtDate(end)}`,
      ),
    };
  } catch (error) {
    console.error("Recommendation Agent Error:", error);
    return {
      status: "error",
      intent,
      response:
        "Sorry, I hit an issue while finding similar listings. Please try again.",
    };
  }
}
