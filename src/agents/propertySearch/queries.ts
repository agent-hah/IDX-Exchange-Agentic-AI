import { query } from "../../db/connection.ts";
import { activeListingWhere } from "../../db/listingFilters.ts";
import { getAnchorDate, shiftMonths } from "../marketStats/queries.ts";
import type { PropertyFilters } from "./parser.ts";

/** Week 3 — parameterized queries over rets_property and california_sold. */

export interface ListingRow {
  L_ListingID: string;
  L_Address: string;
  L_City: string;
  price: number;
  beds: number;
  baths: number;
  sqft: number;
  type: string;
  DaysOnMarket: number;
}

export async function searchActiveListings(filters: Partial<PropertyFilters>, page = 1, limit = 10) {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit))); // never more than 50 rows
  const offset = (Math.max(1, Math.floor(page)) - 1) * safeLimit;
  const { where, params } = activeListingWhere(filters);
  const sql = `
    SELECT
      L_ListingID, L_DisplayId, L_Address, L_City, L_Zip,
      L_SystemPrice AS price, L_Keyword2 AS beds, LM_Dec_3 AS baths,
      LM_Int2_3 AS sqft, L_Type_ AS type, L_Status AS status,
      LMD_MP_Latitude AS lat, LMD_MP_Longitude AS lng,
      YearBuilt, AssociationFee, DaysOnMarket,
      PoolPrivateYN, ViewYN, FireplaceYN, PhotoCount,
      LA1_UserFirstName, LA1_UserLastName, LO1_OrganizationName
    FROM rets_property
    WHERE ${where}
    ORDER BY L_SystemPrice ASC LIMIT ${safeLimit} OFFSET ${offset}`;
  return query<ListingRow>(sql, params);
}

export interface SoldRow {
  ListingKey: string;
  UnparsedAddress: string;
  City: string;
  CloseDate: string;
  ClosePrice: number;
  DaysOnMarket: number;
}

/**
 * Recent residential sales in a city. The window ends at the latest close date
 * in the data (see marketStats/queries.ts), since california_sold is a static
 * snapshot and CURDATE()-based windows go empty.
 */
export async function getSoldComps(city: string, months = 12) {
  const end = await getAnchorDate();
  const start = shiftMonths(end, -months);
  const sql = `
    SELECT
      ListingKey, UnparsedAddress, City, CloseDate, ClosePrice,
      OriginalListPrice, ListPrice, DaysOnMarket,
      BedroomsTotal, BathroomsTotalInteger, LivingArea,
      PropertyType, PropertySubType, YearBuilt,
      ListAgentFullName, ListOfficeName, BuyerOfficeName
    FROM california_sold
    WHERE City = ?
      AND CloseDate > ? AND CloseDate <= ?
      AND PropertyType = 'Residential'
    ORDER BY CloseDate DESC
    LIMIT 50`;
  return query<SoldRow>(sql, [city, start, end]);
}
