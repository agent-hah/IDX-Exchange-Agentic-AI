export interface PropertyFilters {
  city: string | null;
  maxPrice: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  type: string | null;
  pool: string | null;
  hasView: string | null;
}

export async function propertySearch(query: string): Promise<PropertyFilters> {
  const cityMatch = query.match(
    /in ([A-Za-z\s]+?)(?:\s+under|\s+with|\s+at|$)/,
  );
  const priceMatch = query.match(/under \$?([\d,.]+)(k|m)?/i);
  const bedsMatch = query.match(/(\d+)[\s-]*(bed|beds|bedroom|bedrooms)/i);
  const bathsMatch = query.match(
    /(\d+(?:\.5)?)[\s-]*(bath|baths|bathroom|bathrooms)/i,
  );
  const sqftMatch = query.match(
    /(\d+)[\s-]*(sqft|sq ft|square feet|square foot)/i,
  );
  const poolMatch = /pool/i.test(query);
  const viewMatch = /view/i.test(query);

  const typeMap: Record<string, string> = {
    condo: "Condominium",
    townhome: "Townhouse",
    "single family": "SingleFamilyResidence",
    land: "Unimproved Land",
  };

  const typeKey = Object.keys(typeMap).find((key) =>
    query.toLowerCase().includes(key),
  );

  let maxPrice = null;
  if (priceMatch) {
    maxPrice = Number(priceMatch[1].replace(/,/g, ""));
    if (priceMatch[2]?.toLowerCase() === "k") maxPrice *= 1000;
    if (priceMatch[2]?.toLowerCase() === "m") maxPrice *= 1000000;
  }

  return {
    city: cityMatch?.[1]?.trim() || null,
    maxPrice,
    beds: bedsMatch ? Number(bedsMatch[1]) : null,
    baths: bathsMatch ? Number(bathsMatch[1]) : null,
    sqft: sqftMatch ? Number(sqftMatch[1]) : null,
    type: typeKey ? typeMap[typeKey] : null,
    pool: poolMatch ? "True" : null,
    hasView: viewMatch ? "True" : null,
  };
}

export async function handleMessage(message: string) {
  try {
    const filters = await propertySearch(message);

    return {
      status: "success",
      intent: "property_search",
      filters: filters,
    };
  } catch (error) {
    return { response: "I could not understand the search request." };
  }
}
