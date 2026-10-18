import { parsePropertyQuery } from "./propertySearch";
import { searchActiveListings, ListingRow } from "./propertyQueries";

export async function handleMessage(message: string) {
  try {
    const filters = await parsePropertyQuery(message);

    if (!filters.city && !filters.maxPrice && !filters.beds) {
      return {
        response:
          "I couldn't quite understand your search criteria. Could you specify a city, budget, or property type?",
      };
    }

    const listings = await searchActiveListings(filters, 1, 5);

    if (listings.length === 0) {
      return {
        response:
          "I couldn't find any active listings matching those exact criteria. Try adjusting your budget or search area.",
      };
    }

    const propertyCards = listings
      .map((listing: ListingRow) => {
        // Destructure the properties so we don't have to keep writing 'listing.'
        const { L_Address, L_City, price, beds, baths, sqft, DaysOnMarket } =
          listing;

        // Break the formatting down into clean, readable variables
        const header = `*${L_Address}, ${L_City}*`;
        const formattedPrice = `$${Number(price).toLocaleString()}`;
        const specs = `${beds || 0}bd / ${baths || 0}ba | ${sqft || 0} sqft`;
        const footer = `🗓 ${DaysOnMarket || 0} days on market`;

        // Build the card as an array and join with a single newline, avoiding messy literal blocks
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
