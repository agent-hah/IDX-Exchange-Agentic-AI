/**
 * Week 5 integration test — runs against your local MySQL.
 *   node src/tests/testMarketStats.ts
 */
import { closeConnection, query } from "../db/connection.ts";
import { marketStatsAgent } from "../skills/marketStatsSkill.ts";
import { getAnchorDate, getMarketReport, getMedian, shiftMonths } from "../skills/marketQueries.ts";
import { handleOpenClawPayload } from "../index.ts";

const questions = [
  "Is now a good time to buy in San Diego?",
  "What is the average price per sq ft in Pasadena?",
  "Median price for condos in Irvine over the last 6 months",
  "How is the market in 92618?",
  "Show me market trends", // no location -> statewide leaderboard
  "Market stats in Notarealcity", // empty result path
];

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.error(`  ✗ ${msg}`); failures++; }
}

async function run() {
  const anchor = await getAnchorDate();
  console.log(`Data anchor (latest residential CloseDate): ${anchor}\n`);

  for (const q of questions) {
    console.log(`\n================ User: "${q}"`);
    const res = await marketStatsAgent(q, "market_test_user");
    console.log(res.response);
    check(res.status !== "error", "no error");
  }

  // Sanity checks on the numbers themselves.
  console.log("\n================ Sanity checks (San Diego, 12 mo)");
  const f = { city: "San Diego", zip: null, subType: null, months: 12 };
  const r = await getMarketReport(f);
  const c = r.current;
  check(c.sold_count > 0, `sold_count > 0 (${c.sold_count})`);
  check(c.median_close_price !== null && c.median_close_price > 0, `median price positive (${c.median_close_price})`);
  check(c.list_to_close_pct === null || (c.list_to_close_pct > 80 && c.list_to_close_pct < 120), `list-to-close plausible (${c.list_to_close_pct}%)`);
  const expectedMonths = Math.ceil(r.coverage.covered_months);
  check(Math.abs(r.trend.length - expectedMonths) <= 1, `trend months (${r.trend.length}) match covered window (~${r.coverage.covered_months} mo, data starts ${r.coverage.data_start})`);
  check(!r.coverage.yoy_available ? r.yoy.median_price_pct === null : true, `YoY suppressed when prior year missing (yoy_available=${r.coverage.yoy_available})`);
  const pace = c.sold_count / r.coverage.covered_months;
  check(r.inventory.months_of_supply === null || Math.abs(r.inventory.months_of_supply - r.inventory.active_count / pace) < 0.11, `months of supply uses covered months (${r.inventory.months_of_supply})`);
  check(r.trend.every((p) => !p.partial || p.mom_change_pct === null), "no MoM % on partial months");
  check(r.trend.reduce((s, p) => s + p.sales, 0) === c.sold_count, "monthly sales sum to window total");

  // Cross-check the window-function median against a brute-force median.
  const start = shiftMonths(anchor, -12);
  const prices = await query<{ ClosePrice: number }>(
    `SELECT ClosePrice FROM california_sold
      WHERE PropertyType = 'Residential' AND ClosePrice > 0
        AND CloseDate > ? AND CloseDate <= ? AND City = ?
      ORDER BY ClosePrice`,
    [start, anchor, "San Diego"],
  );
  const v = prices.map((p) => Number(p.ClosePrice));
  const mid = Math.floor(v.length / 2);
  const brute = v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
  const sqlMedian = await getMedian("price", f, start, anchor);
  check(sqlMedian !== null && Math.abs(sqlMedian - brute) <= 1, `SQL median ${sqlMedian} == brute-force median ${Math.round(brute)}`);

  // Routing through the OpenClaw entry point.
  console.log("\n================ Router");
  const routed = await handleOpenClawPayload({ message: "Are prices rising in Irvine?", userId: "router_test" });
  check(routed.intent === "market_stats", "market question routed to marketStatsAgent");
  const search = await handleOpenClawPayload({ message: "Find homes in Irvine", userId: "router_test" });
  check(search.intent !== "market_stats", "search question still goes to property search");

  console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
  await closeConnection();
  if (failures) process.exit(1);
}

run().catch(async (e) => {
  console.error(e);
  await closeConnection();
  process.exit(1);
});
