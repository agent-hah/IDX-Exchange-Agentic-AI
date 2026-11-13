import { getSession, updateSession } from "../../memory/session.ts";
import type { AgentResult } from "../../types.ts";
import { fmtPrice, typeLabel } from "../../utils/format.ts";
import { parsePropertyQuery, type PropertyFilters } from "./parser.ts";
import { searchActiveListings, type ListingRow } from "./queries.ts";

/**
 * Weeks 2–4 — conversational property search.
 * Merges each message's filters into the user's session, asks for city →
 * budget → bedrooms until it has enough, then returns property cards.
 */

function withoutNulls<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined)) as Partial<T>;
}

/** "Irvine · Condo or Townhome · up to $1,500,000 · 3+ beds" — so applied filters are visible. */
export function describeFilters(f: Partial<PropertyFilters>): string {
  const types = f.types && f.types.length > 1 ? f.types : f.type ? [f.type] : [];
  return [
    f.city,
    types.length ? types.map(typeLabel).join(" or ") : null,
    f.maxPrice ? `up to ${fmtPrice(f.maxPrice)}` : null,
    f.beds ? `${f.beds}+ beds` : null,
    f.baths ? `${f.baths}+ baths` : null,
    f.sqft ? `${f.sqft}+ sqft` : null,
    f.pool ? "private pool" : null,
    f.hasView ? "view" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function formatCards(listings: ListingRow[]): string {
  return listings
    .map(({ L_Address, L_City, price, beds, baths, sqft, type, DaysOnMarket }) =>
      [
        `*${L_Address}, ${L_City}*`,
        `${fmtPrice(price)} | ${beds || 0}bd / ${baths || 0}ba | ${sqft || 0} sqft${type ? ` | ${typeLabel(type)}` : ""}`,
        `🗓 ${DaysOnMarket || 0} days on market`,
      ].join("\n"),
    )
    .join("\n\n---\n\n");
}

/**
 * @param hints Structured filters from a caller that already understood the
 *   request (e.g. OpenClaw's model). Non-null hints override what the regex
 *   parser extracted from `message`.
 */
export async function propertySearchAgent(
  message: string,
  userId: string,
  hints: Partial<PropertyFilters> = {},
): Promise<AgentResult<{ filters: Partial<PropertyFilters>; listings?: ListingRow[] }>> {
  const intent = "property_search";
  try {
    const session = getSession(userId);

    // Merge new filters into the session, ignoring nulls so earlier answers aren't erased.
    const updates: Partial<PropertyFilters> = {};
    const parsed = { ...parsePropertyQuery(message), ...withoutNulls(hints) };
    for (const [key, value] of Object.entries(parsed)) {
      if (value !== null) (updates as Record<string, unknown>)[key] = value;
    }
    // A new type choice replaces the old one, whether it names one type or several.
    if (updates.types && updates.types.length > 0) updates.type = updates.types[0] ?? null;
    else if (updates.type) updates.types = null;
    updateSession(userId, { ...updates, conversationStep: (session.conversationStep || 0) + 1 });
    const s = getSession(userId);
    const filters: Partial<PropertyFilters> = {
      city: s.city ?? null, maxPrice: s.maxPrice ?? null, beds: s.beds ?? null, baths: s.baths ?? null,
      sqft: s.sqft ?? null, type: s.type ?? null, types: s.types ?? null, pool: s.pool ?? null, hasView: s.hasView ?? null,
    };

    // Follow-up questions until we have enough to search.
    if (!s.city) {
      return { status: "needs_input", intent, data: { filters }, response: "What city are you looking to buy in?" };
    }
    if (!s.maxPrice) {
      return { status: "needs_input", intent, data: { filters }, response: `Got it, looking in ${s.city}. What is your maximum budget?` };
    }
    if (!s.beds) {
      return { status: "needs_input", intent, data: { filters }, response: `Almost there! How many bedrooms do you need in ${s.city}?` };
    }

    const listings = await searchActiveListings(filters, 1, 5);
    if (listings.length === 0) {
      return {
        status: "empty",
        intent,
        data: { filters, listings },
        response: `I couldn't find any active listings in ${s.city} under ${fmtPrice(s.maxPrice)} with those exact criteria. Try adjusting your budget or search area.`,
      };
    }

    updateSession(userId, { lastResults: listings });
    return {
      status: "success",
      intent,
      data: { filters, listings },
      response: `Here are the top matches I found (${describeFilters(filters)}):\n\n${formatCards(listings)}`,
    };
  } catch (error) {
    console.error("Property Search Agent Error:", error);
    return {
      status: "error",
      intent,
      response: "Sorry, I hit an issue while searching the MLS database. Please try again.",
    };
  }
}
