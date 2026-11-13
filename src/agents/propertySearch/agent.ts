import { getSession, updateSession } from "../../memory/session.ts";
import type { AgentResult } from "../../types.ts";
import { fmtPrice } from "../../utils/format.ts";
import { parsePropertyQuery, type PropertyFilters } from "./parser.ts";
import { searchActiveListings, type ListingRow } from "./queries.ts";

/**
 * Weeks 2–4 — conversational property search.
 * Merges each message's filters into the user's session, asks for city →
 * budget → bedrooms until it has enough, then returns property cards.
 */

function formatCards(listings: ListingRow[]): string {
  return listings
    .map(({ L_Address, L_City, price, beds, baths, sqft, DaysOnMarket }) =>
      [
        `*${L_Address}, ${L_City}*`,
        `${fmtPrice(price)} | ${beds || 0}bd / ${baths || 0}ba | ${sqft || 0} sqft`,
        `🗓 ${DaysOnMarket || 0} days on market`,
      ].join("\n"),
    )
    .join("\n\n---\n\n");
}

export async function propertySearchAgent(
  message: string,
  userId: string,
): Promise<AgentResult<{ filters: Partial<PropertyFilters>; listings?: ListingRow[] }>> {
  const intent = "property_search";
  try {
    const session = getSession(userId);

    // Merge new filters into the session, ignoring nulls so earlier answers aren't erased.
    const updates: Partial<PropertyFilters> = {};
    for (const [key, value] of Object.entries(parsePropertyQuery(message))) {
      if (value !== null) (updates as Record<string, unknown>)[key] = value;
    }
    updateSession(userId, { ...updates, conversationStep: (session.conversationStep || 0) + 1 });
    const s = getSession(userId);
    const filters: Partial<PropertyFilters> = {
      city: s.city ?? null, maxPrice: s.maxPrice ?? null, beds: s.beds ?? null, baths: s.baths ?? null,
      sqft: s.sqft ?? null, type: s.type ?? null, pool: s.pool ?? null, hasView: s.hasView ?? null,
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
      response: `Here are the top matches I found:\n\n${formatCards(listings)}`,
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
