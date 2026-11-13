/** Week 5 against the live database.  npm run test:db */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { closeConnection, query } from "../../src/db/connection.ts";
import { marketStatsAgent } from "../../src/agents/marketStats/agent.ts";
import { getAnchorDate, getMarketReport, getMedian, shiftMonths } from "../../src/agents/marketStats/queries.ts";
import { route } from "../../src/index.ts";

after(() => closeConnection());

const questions: [string, string][] = [
  ["Is now a good time to buy in San Diego?", "success"],
  ["What is the average price per sq ft in Pasadena?", "success"],
  ["Median price for condos in Irvine over the last 6 months", "success"],
  ["How is the market in 92618?", "success"],
  ["Show me market trends", "success"], // no location → statewide leaderboard
  ["Market stats in Notarealcity", "empty"],
];
for (const [q, expected] of questions) {
  test(`agent answers: ${q}`, async () => {
    const r = await marketStatsAgent(q, "it_market");
    assert.equal(r.status, expected, r.response);
  });
}

const sd = { city: "San Diego", zip: null, subType: null, months: 12 };

test("San Diego report: numbers are plausible", async () => {
  const { current: c, coverage, trend, yoy, inventory } = await getMarketReport(sd);
  assert.ok(c.sold_count > 0);
  assert.ok(c.median_close_price !== null && c.median_close_price > 0);
  assert.ok(c.list_to_close_pct === null || (c.list_to_close_pct > 80 && c.list_to_close_pct < 120));
  assert.ok(Math.abs(trend.length - Math.ceil(coverage.covered_months)) <= 1, "trend covers the data window");
  if (!coverage.yoy_available) assert.equal(yoy.median_price_pct, null, "YoY hidden without a prior year");
  const pace = c.sold_count / coverage.covered_months;
  if (inventory.months_of_supply !== null) {
    assert.ok(Math.abs(inventory.months_of_supply - inventory.active_count / pace) < 0.11, "supply uses covered months");
  }
  assert.ok(trend.every((p) => !p.partial || p.mom_change_pct === null), "no MoM % on partial months");
  assert.equal(trend.reduce((s, p) => s + p.sales, 0), c.sold_count, "monthly sales sum to the total");
});

test("SQL median matches a brute-force median", async () => {
  const anchor = await getAnchorDate();
  const start = shiftMonths(anchor, -12);
  const rows = await query<{ ClosePrice: number }>(
    `SELECT ClosePrice FROM california_sold
      WHERE PropertyType = 'Residential' AND ClosePrice > 0
        AND CloseDate > ? AND CloseDate <= ? AND City = ?
      ORDER BY ClosePrice`,
    [start, anchor, "San Diego"],
  );
  const v = rows.map((p) => Number(p.ClosePrice));
  const mid = Math.floor(v.length / 2);
  const brute = v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
  const sqlMedian = await getMedian("price", sd, start, anchor);
  assert.ok(sqlMedian !== null && Math.abs(sqlMedian - brute) <= 1, `${sqlMedian} vs ${brute}`);
});

test("router: market questions go to the market agent, searches don't", async () => {
  assert.equal((await route("Are prices rising in Irvine?", "it_router")).intent, "market_stats");
  assert.equal((await route("Find homes in Irvine", "it_router2")).intent, "property_search");
});
