import { query } from "../../db/connection.ts";
import { getAnchorDate, num, shiftMonths } from "../marketStats/queries.ts";

/** Week 7 — SQL: candidate listings (rets_property) and comp checks (california_sold). */

export interface ListingSummary {
  L_ListingID: string;
  L_Address: string;
  L_City: string;
  price: number;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  type: string | null;
  DaysOnMarket: number | null;
}

const LISTING_COLUMNS = `
  L_ListingID, L_Address, L_City, L_SystemPrice AS price, L_Keyword2 AS beds,
  LM_Dec_3 AS baths, LM_Int2_3 AS sqft, L_Type_ AS type, DaysOnMarket`;

export async function getListing(id: string): Promise<ListingSummary | null> {
  const rows = await query<ListingSummary>(
    `SELECT ${LISTING_COLUMNS} FROM rets_property WHERE L_ListingID = ?`,
    [id],
  );
  return rows[0] ?? null;
}

/** An active listing whose address starts with the given text (e.g. "59 Fox Hollow"). */
export async function findListingByAddress(
  address: string,
  city?: string | null,
): Promise<ListingSummary | null> {
  let sql = `SELECT ${LISTING_COLUMNS} FROM rets_property WHERE L_Status = 'Active' AND L_Address LIKE ?`;
  const params: string[] = [`${address.trim()}%`];
  if (city) {
    sql += " AND L_City = ?";
    params.push(city.trim());
  }
  const rows = await query<ListingSummary>(`${sql} LIMIT 1`, params);
  return rows[0] ?? null;
}

/**
 * Candidates worth scoring: other active listings within $300K of the target
 * (anything further earns no price points). Same city first; the agent widens
 * to any city if that leaves too few.
 */
export async function getCandidates(
  target: ListingSummary,
  opts: { sameCity: boolean; limit?: number },
) {
  const limit = Math.max(1, Math.min(500, opts.limit ?? 300));
  const price = Number(target.price);
  let sql = `SELECT ${LISTING_COLUMNS} FROM rets_property 
               WHERE L_Status = 'Active' AND L_ListingID <> ? AND 
                L_SystemPrice BETWEEN ? AND ?`;
  const params: (string | number)[] = [
    target.L_ListingID,
    price - 300_000,
    price + 300_000,
  ];
  if (opts.sameCity) {
    sql += " AND L_City = ?";
    params.push(target.L_City);
  }
  sql += ` order by ABS(L_SystemPrice - ?) ASC LIMIT ${limit}`;
  params.push(price);
  return query<ListingSummary>(sql, params);
}

export interface CompCheck {
  compCount: number;
  avgPpsf: number | null; // average close price per square foot of the comps
  compPrice: number | null; // avgPpsf x this listing's sqft
  deltaPct: number | null; // how far the list price is above (+) or below (-) compPrice
}

/**
 * Handbook comp validation: residential sales in the same city, within ±20%
 * of this listing's size, over the last `months` months of the data
 * (anchored on the latest close date, like Week 5).
 */
export async function validateWithComps(
  city: string,
  sqft: number | null,
  price: number,
  months = 6,
): Promise<CompCheck> {
  if (!sqft || sqft <= 0)
    return { compCount: 0, avgPpsf: null, compPrice: null, deltaPct: null };
  const end = await getAnchorDate();
  const start = shiftMonths(end, -months);
  const rows = await query<{ avg_ppsf: unknown; comp_count: unknown }>(
    `SELECT AVG(CASE WHEN LivingArea >= 200 THEN ClosePrice / LivingArea END) AS avg_ppsf,
            COUNT(*) AS comp_count
       FROM california_sold
      WHERE City = ? AND PropertyType = 'Residential' AND ClosePrice > 0
        AND LivingArea BETWEEN ? AND ?
        AND CloseDate > ? AND CloseDate <= ?`,
    [city, sqft * 0.8, sqft * 1.2, start, end],
  );
  const avgPpsf = num(rows[0]?.avg_ppsf);
  const compCount = num(rows[0]?.comp_count) ?? 0;
  if (avgPpsf === null || compCount === 0)
    return { compCount, avgPpsf: null, compPrice: null, deltaPct: null };
  const compPrice = Math.round(avgPpsf * sqft);
  const deltaPct = Math.round(((price - compPrice) / compPrice) * 1000) / 10;
  return { compCount, avgPpsf: Math.round(avgPpsf), compPrice, deltaPct };
}
