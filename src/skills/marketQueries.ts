import { query } from "../db/connection.ts";

/**
 * Week 5 — Market Statistics query layer over california_sold.
 *
 * Notes on the data:
 *  - CloseDate is a VARCHAR in YYYY-MM-DD form, so plain string comparison
 *    orders correctly (and stays index-friendly).
 *  - california_sold covers 2021–2025. A window anchored on CURDATE() would
 *    return nothing once the data is stale, so every window is anchored on the
 *    latest residential CloseDate in the table (capped at today).
 *  - mysql2 returns DECIMAL results (ROUND/AVG) as strings, hence num().
 */

export interface MarketFilters {
  city: string | null;
  zip: string | null;
  subType: string | null; // california_sold.PropertySubType / rets_property.L_Type_
  months: number; // window length, e.g. 12
}

export interface MarketSummary {
  sold_count: number;
  avg_close_price: number | null;
  median_close_price: number | null;
  avg_price_per_sqft: number | null;
  median_price_per_sqft: number | null;
  avg_dom: number | null;
  median_dom: number | null;
  list_to_close_pct: number | null; // ClosePrice / ListPrice
  orig_list_to_close_pct: number | null; // ClosePrice / OriginalListPrice
  pct_at_or_above_list: number | null;
}

export interface TrendPoint {
  month: string; // YYYY-MM
  partial: boolean; // month only partly inside the window / data range
  sales: number;
  median_price: number | null;
  avg_price: number | null;
  avg_ppsf: number | null;
  avg_dom: number | null;
  list_to_close_pct: number | null;
  mom_change_pct: number | null; // vs previous full month; null for partial months
}

export interface CityRow {
  City: string;
  sold_count: number;
  avg_close_price: number | null;
  avg_price_per_sqft: number | null;
  avg_dom: number | null;
  list_to_close_pct: number | null;
}

export interface MarketReport {
  filters: MarketFilters;
  window: { start: string; end: string }; // (start, end] on CloseDate
  coverage: {
    data_start: string; // earliest residential CloseDate in the table
    first_day: string; // first day actually covered by this window
    covered_months: number; // may be < filters.months when data is short
    truncated: boolean; // window reaches back before the data starts
    yoy_available: boolean; // prior-year window fully inside the data
  };
  current: MarketSummary;
  priorYear: MarketSummary; // same-length window, one year earlier
  // Median price: last full month vs first full month in the window.
  window_change: { from: string; to: string; median_price_pct: number | null } | null;
  yoy: {
    median_price_pct: number | null;
    median_ppsf_pct: number | null;
    median_dom_change: number | null;
    sales_pct: number | null;
  };
  trend: TrendPoint[];
  inventory: {
    active_count: number;
    months_of_supply: number | null;
  };
}

// ---------------------------------------------------------------------------
// Shared SQL fragments. Bad rows (LivingArea = 1, ListPrice = 1, etc.) exist in
// real MLS exports, so implausible values are nulled out rather than averaged.
// ---------------------------------------------------------------------------
const PPSF_EXPR =
  "CASE WHEN LivingArea >= 200 THEN ClosePrice / LivingArea END";
const LIST_RATIO_EXPR =
  "CASE WHEN ListPrice > 0 AND ClosePrice / ListPrice BETWEEN 0.5 AND 1.5 THEN ClosePrice / ListPrice END";
const ORIG_RATIO_EXPR =
  "CASE WHEN OriginalListPrice > 0 AND ClosePrice / OriginalListPrice BETWEEN 0.5 AND 1.5 THEN ClosePrice / OriginalListPrice END";
const DOM_EXPR = "CASE WHEN DaysOnMarket >= 0 THEN DaysOnMarket END";

const MEDIAN_EXPRS = {
  price: "ClosePrice",
  ppsf: PPSF_EXPR,
  dom: DOM_EXPR,
} as const;

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Shift a YYYY-MM-DD date by whole months (UTC, clamps to month end). */
export function shiftMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Inclusive day count between two YYYY-MM-DD dates. */
export function daysBetween(first: string, last: string): number {
  return Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000) + 1;
}

function lastDayOfMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function pctChange(curr: number | null, prev: number | null) {
  if (curr === null || prev === null || prev === 0) return null;
  return Math.round(((curr - prev) / prev) * 1000) / 10;
}

function buildWhere(f: MarketFilters, start: string, end: string) {
  const clauses = [
    "PropertyType = 'Residential'",
    "ClosePrice > 0",
    "CloseDate > ?",
    "CloseDate <= ?",
  ];
  const params: (string | number)[] = [start, end];
  if (f.city) {
    clauses.push("City = ?");
    params.push(f.city);
  }
  if (f.zip) {
    clauses.push("PostalCode = ?");
    params.push(f.zip);
  }
  if (f.subType) {
    clauses.push("PropertySubType = ?");
    params.push(f.subType);
  }
  return { where: clauses.join(" AND "), params };
}

// ---------------------------------------------------------------------------
// Anchor date
// ---------------------------------------------------------------------------
let cachedAnchor: string | null = null;

export async function getAnchorDate(): Promise<string> {
  if (cachedAnchor) return cachedAnchor;
  const override = process.env.MARKET_ANCHOR_DATE; // optional, YYYY-MM-DD
  if (override && /^\d{4}-\d{2}-\d{2}$/.test(override)) {
    cachedAnchor = override;
    return override;
  }
  const today = new Date().toISOString().slice(0, 10);
  const rows = await query<{ anchor: string | null }>(
    `SELECT MAX(CloseDate) AS anchor
       FROM california_sold
      WHERE PropertyType = 'Residential' AND CloseDate <= ?`,
    [today],
  );
  cachedAnchor = rows[0]?.anchor ? String(rows[0].anchor).slice(0, 10) : today;
  return cachedAnchor;
}

let cachedDataStart: string | null = null;

/** Earliest residential CloseDate — tells us how far back windows can really go. */
export async function getDataStart(): Promise<string> {
  if (cachedDataStart) return cachedDataStart;
  const rows = await query<{ first: string | null }>(
    `SELECT MIN(CloseDate) AS first
       FROM california_sold
      WHERE PropertyType = 'Residential' AND CloseDate >= '1990-01-01'`,
  );
  cachedDataStart = rows[0]?.first ? String(rows[0].first).slice(0, 10) : "1990-01-01";
  return cachedDataStart;
}

// ---------------------------------------------------------------------------
// Medians (MySQL 8 window functions — there is no MEDIAN() in MySQL)
// ---------------------------------------------------------------------------
export async function getMedian(
  metric: keyof typeof MEDIAN_EXPRS,
  f: MarketFilters,
  start: string,
  end: string,
): Promise<number | null> {
  const { where, params } = buildWhere(f, start, end);
  const decimals = metric === "dom" ? 1 : 0;
  const sql = `
    SELECT ROUND(AVG(v), ${decimals}) AS median
      FROM (
        SELECT v,
               ROW_NUMBER() OVER (ORDER BY v) AS rn,
               COUNT(*) OVER () AS cnt
          FROM (SELECT ${MEDIAN_EXPRS[metric]} AS v
                  FROM california_sold
                 WHERE ${where}) AS s
         WHERE v IS NOT NULL
      ) AS r
     WHERE rn IN (FLOOR((cnt + 1) / 2), CEIL((cnt + 1) / 2))`;
  const rows = await query<{ median: unknown }>(sql, params);
  return num(rows[0]?.median);
}

// ---------------------------------------------------------------------------
// Window summary
// ---------------------------------------------------------------------------
export async function getMarketSummary(
  f: MarketFilters,
  start: string,
  end: string,
): Promise<MarketSummary> {
  const { where, params } = buildWhere(f, start, end);
  const aggSql = `
    SELECT
      COUNT(*)                                     AS sold_count,
      ROUND(AVG(ClosePrice), 0)                    AS avg_close_price,
      ROUND(AVG(${PPSF_EXPR}), 0)                  AS avg_price_per_sqft,
      ROUND(AVG(${DOM_EXPR}), 1)                   AS avg_dom,
      ROUND(AVG(${LIST_RATIO_EXPR}) * 100, 1)      AS list_to_close_pct,
      ROUND(AVG(${ORIG_RATIO_EXPR}) * 100, 1)      AS orig_list_to_close_pct,
      ROUND(AVG(CASE WHEN ListPrice > 0 THEN ClosePrice >= ListPrice END) * 100, 1)
                                                   AS pct_at_or_above_list
    FROM california_sold
    WHERE ${where}`;

  const [aggRows, medPrice, medPpsf, medDom] = await Promise.all([
    query<Record<string, unknown>>(aggSql, params),
    getMedian("price", f, start, end),
    getMedian("ppsf", f, start, end),
    getMedian("dom", f, start, end),
  ]);
  const a = aggRows[0] ?? {};
  return {
    sold_count: num(a.sold_count) ?? 0,
    avg_close_price: num(a.avg_close_price),
    median_close_price: medPrice,
    avg_price_per_sqft: num(a.avg_price_per_sqft),
    median_price_per_sqft: medPpsf,
    avg_dom: num(a.avg_dom),
    median_dom: medDom,
    list_to_close_pct: num(a.list_to_close_pct),
    orig_list_to_close_pct: num(a.orig_list_to_close_pct),
    pct_at_or_above_list: num(a.pct_at_or_above_list),
  };
}

// ---------------------------------------------------------------------------
// Monthly trend (avg metrics + per-month median price, MoM change)
// ---------------------------------------------------------------------------
export async function getMonthlyTrend(
  f: MarketFilters,
  start: string,
  end: string,
  firstDay: string = addDays(start, 1), // first day with data in the window
): Promise<TrendPoint[]> {
  const isPartial = (month: string) =>
    (month === firstDay.slice(0, 7) && !firstDay.endsWith("-01")) ||
    (month === end.slice(0, 7) && end !== lastDayOfMonth(month));
  const { where, params } = buildWhere(f, start, end);
  const aggSql = `
    SELECT month,
           COUNT(*)                        AS sales,
           ROUND(AVG(ClosePrice), 0)       AS avg_price,
           ROUND(AVG(ppsf), 0)             AS avg_ppsf,
           ROUND(AVG(dom), 1)              AS avg_dom,
           ROUND(AVG(ratio) * 100, 1)      AS list_to_close_pct
      FROM (SELECT LEFT(CloseDate, 7)     AS month,
                   ClosePrice,
                   ${PPSF_EXPR}           AS ppsf,
                   ${DOM_EXPR}            AS dom,
                   ${LIST_RATIO_EXPR}     AS ratio
              FROM california_sold
             WHERE ${where}) AS b
     GROUP BY month
     ORDER BY month`;
  const medianSql = `
    SELECT month, ROUND(AVG(ClosePrice), 0) AS median_price
      FROM (SELECT LEFT(CloseDate, 7) AS month,
                   ClosePrice,
                   ROW_NUMBER() OVER (PARTITION BY LEFT(CloseDate, 7) ORDER BY ClosePrice) AS rn,
                   COUNT(*)     OVER (PARTITION BY LEFT(CloseDate, 7))                     AS cnt
              FROM california_sold
             WHERE ${where}) AS r
     WHERE rn IN (FLOOR((cnt + 1) / 2), CEIL((cnt + 1) / 2))
     GROUP BY month`;

  const [aggRows, medRows] = await Promise.all([
    query<Record<string, unknown>>(aggSql, params),
    query<{ month: string; median_price: unknown }>(medianSql, params),
  ]);
  const medians = new Map(medRows.map((r) => [r.month, num(r.median_price)]));

  // MoM only between full months — a half month of sales is not comparable.
  let prevFullMedian: number | null = null;
  return aggRows.map((r) => {
    const month = String(r.month);
    const median = medians.get(month) ?? null;
    const partial = isPartial(month);
    const point: TrendPoint = {
      month,
      partial,
      sales: num(r.sales) ?? 0,
      median_price: median,
      avg_price: num(r.avg_price),
      avg_ppsf: num(r.avg_ppsf),
      avg_dom: num(r.avg_dom),
      list_to_close_pct: num(r.list_to_close_pct),
      mom_change_pct: partial ? null : pctChange(median, prevFullMedian),
    };
    if (!partial) prevFullMedian = median;
    return point;
  });
}

// ---------------------------------------------------------------------------
// Inventory: active listings in rets_property (current snapshot)
// ---------------------------------------------------------------------------
export async function getActiveInventory(f: MarketFilters): Promise<number> {
  let sql = `SELECT COUNT(*) AS active_count
               FROM rets_property
              WHERE L_Status = 'Active' AND L_Class = 'Residential'`;
  const params: string[] = [];
  if (f.city) {
    sql += " AND L_City = ?";
    params.push(f.city);
  }
  if (f.zip) {
    sql += " AND L_Zip = ?";
    params.push(f.zip);
  }
  if (f.subType) {
    sql += " AND L_Type_ = ?";
    params.push(f.subType);
  }
  const rows = await query<{ active_count: unknown }>(sql, params);
  return num(rows[0]?.active_count) ?? 0;
}

// ---------------------------------------------------------------------------
// Statewide leaderboard (handbook "City Market Summary"), used when no
// location is given.
// ---------------------------------------------------------------------------
export async function getCityLeaderboard(
  months = 12,
  limit = 10,
): Promise<{ window: { start: string; end: string; first_day: string }; rows: CityRow[] }> {
  const [end, dataStart] = await Promise.all([getAnchorDate(), getDataStart()]);
  const start = shiftMonths(end, -months);
  const firstDay = dataStart > addDays(start, 1) ? dataStart : addDays(start, 1);
  const safeLimit = Math.max(1, Math.min(25, Math.floor(limit)));
  const sql = `
    SELECT City,
           COUNT(*)                                AS sold_count,
           ROUND(AVG(ClosePrice), 0)               AS avg_close_price,
           ROUND(AVG(${PPSF_EXPR}), 0)             AS avg_price_per_sqft,
           ROUND(AVG(${DOM_EXPR}), 1)              AS avg_dom,
           ROUND(AVG(${LIST_RATIO_EXPR}) * 100, 1) AS list_to_close_pct
      FROM california_sold
     WHERE PropertyType = 'Residential'
       AND ClosePrice > 0
       AND CloseDate > ? AND CloseDate <= ?
       AND City IS NOT NULL AND City <> ''
     GROUP BY City
     ORDER BY sold_count DESC
     LIMIT ${safeLimit}`;
  const rows = await query<Record<string, unknown>>(sql, [start, end]);
  return {
    window: { start, end, first_day: firstDay },
    rows: rows.map((r) => ({
      City: String(r.City),
      sold_count: num(r.sold_count) ?? 0,
      avg_close_price: num(r.avg_close_price),
      avg_price_per_sqft: num(r.avg_price_per_sqft),
      avg_dom: num(r.avg_dom),
      list_to_close_pct: num(r.list_to_close_pct),
    })),
  };
}

// ---------------------------------------------------------------------------
// Full report: current window, same window last year, trend, inventory
// ---------------------------------------------------------------------------
export async function getMarketReport(f: MarketFilters): Promise<MarketReport> {
  const [end, dataStart] = await Promise.all([getAnchorDate(), getDataStart()]);
  const start = shiftMonths(end, -f.months);
  const priorEnd = shiftMonths(end, -12);
  const priorStart = shiftMonths(priorEnd, -f.months);

  // The window is (start, end]; the data may begin later than start.
  const windowFirstDay = addDays(start, 1);
  const firstDay = dataStart > windowFirstDay ? dataStart : windowFirstDay;
  const truncated = dataStart > windowFirstDay;
  const coveredMonths = Math.max(0, Math.round((daysBetween(firstDay, end) / 30.4375) * 10) / 10);
  const yoyAvailable = dataStart <= addDays(priorStart, 1);

  const [current, priorYear, trend, activeCount] = await Promise.all([
    getMarketSummary(f, start, end),
    getMarketSummary(f, priorStart, priorEnd),
    getMonthlyTrend(f, start, end, firstDay),
    getActiveInventory(f),
  ]);

  // Sales pace uses the months actually covered, not the requested window.
  const monthlySales = coveredMonths > 0 ? current.sold_count / coveredMonths : 0;
  const domChange =
    yoyAvailable && current.median_dom !== null && priorYear.median_dom !== null
      ? Math.round((current.median_dom - priorYear.median_dom) * 10) / 10
      : null;
  const yoy = (a: number | null, b: number | null) => (yoyAvailable ? pctChange(a, b) : null);

  const full = trend.filter((p) => !p.partial && p.median_price !== null);
  const firstFull = full[0];
  const lastFull = full[full.length - 1];
  const windowChange =
    firstFull && lastFull && firstFull !== lastFull
      ? {
          from: firstFull.month,
          to: lastFull.month,
          median_price_pct: pctChange(lastFull.median_price, firstFull.median_price),
        }
      : null;

  return {
    filters: f,
    window: { start, end },
    coverage: {
      data_start: dataStart,
      first_day: firstDay,
      covered_months: coveredMonths,
      truncated,
      yoy_available: yoyAvailable,
    },
    current,
    priorYear,
    window_change: windowChange,
    yoy: {
      median_price_pct: yoy(current.median_close_price, priorYear.median_close_price),
      median_ppsf_pct: yoy(current.median_price_per_sqft, priorYear.median_price_per_sqft),
      median_dom_change: domChange,
      sales_pct: yoy(current.sold_count, priorYear.sold_count || null),
    },
    trend,
    inventory: {
      active_count: activeCount,
      months_of_supply:
        monthlySales > 0 ? Math.round((activeCount / monthlySales) * 10) / 10 : null,
    },
  };
}
