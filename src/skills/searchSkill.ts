import { parsePropertyQuery, PropertyFilters } from "./propertySearch";
import { searchActiveListings, ListingRow } from "./propertyQueries";
import { getSession, updateSession, clearSession } from "../memory/session";

export async function handleMessage(message: string, userId: string) {
  try {
    // 1. Load the user's active session state
    const session = getSession(userId);

    const newFilters = await parsePropertyQuery(message);

    // 3. Merge new filters into the session (ignoring nulls so past answers aren't erased)
    const updates: any = {};
    for (const [key, value] of Object.entries(newFilters)) {
      if (value !== null) {
        updates[key] = value;
      }
    }
    
    updateSession(userId, { 
      ...updates, 
      conversationStep: (session.conversationStep || 0) + 1 
    });

    const currentSession = getSession(userId);

    // 4. Conversational Follow-ups: Check if we have enough data to search
    if (!currentSession.city) {
      return { response: "What city are you looking to buy in?" };
    }
    if (!currentSession.maxPrice) {
      return { response: `Got it, looking in ${currentSession.city}. What is your maximum budget?` };
    }
    if (!currentSession.beds) {
      return { response: `Almost there! How many bedrooms do you need in ${currentSession.city}?` };
    }

    const listings = await searchActiveListings(currentSession as PropertyFilters, 1, 5);

    if (listings.length === 0) {
      return {
        response: `I couldn't find any active listings in ${currentSession.city} under $${currentSession.maxPrice?.toLocaleString()} with those exact criteria. Try adjusting your budget or search area.`,
      };
    }

    const propertyCards = listings
      .map((listing: ListingRow) => {
        const { L_Address, L_City, price, beds, baths, sqft, DaysOnMarket } = listing;

        const header = `*${L_Address}, ${L_City}*`;
        const formattedPrice = `$${Number(price).toLocaleString()}`;
        const specs = `${beds || 0}bd / ${baths || 0}ba | ${sqft || 0} sqft`;
        const footer = `🗓 ${DaysOnMarket || 0} days on market`;

        return [header, `${formattedPrice} | ${specs}`, footer].join("\n");
      })
      .join("\n\n---\n\n");

    return {
      status: "success",
      intent: "property_search",
      response: `Here are the top matches I found:\n\n${propertyCards}`,
    };
  } catch (error) {
    console.error("Search Skill Error:", error);
    return {
      response:
        "Sorry, I hit an issue while searching the MLS database. Please try again.",
    };
  }
}
