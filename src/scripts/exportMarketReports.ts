/**
 * Writes Markdown market summaries to docs/market_reports/ — these are the
 * "Week 5 market summaries" the Week 8 RAG pipeline indexes.
 *
 *   node src/scripts/exportMarketReports.ts                 # default city list
 *   node src/scripts/exportMarketReports.ts Irvine "San Diego"
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { closeConnection } from "../db/connection.ts";
import { getMarketReport, type MarketReport } from "../agents/marketStats/queries.ts";
import { marketRead, windowLabel } from "../agents/marketStats/agent.ts";
import { fmtMoney } from "../utils/format.ts";

const DEFAULT_CITIES = [
  "Los Angeles", "San Diego", "San Jose", "San Francisco", "Sacramento",
  "Irvine", "Pasadena", "Riverside", "Fresno", "Long Beach",
];

const pct = (n: number | null) => (n === null ? "n/a" : `${n > 0 ? "+" : ""}${n}%`);

function toMarkdown(city: string, r: MarketReport): string {
  const c = r.current;
  const read = marketRead(r);
  const trendRows = r.trend
    .map((p) => `| ${p.month}${p.partial ? " (partial)" : ""} | ${p.sales} | ${fmtMoney(p.median_price)} | ${pct(p.mom_change_pct)} | ${fmtMoney(p.avg_ppsf)} | ${p.avg_dom ?? "n/a"} | ${p.list_to_close_pct ?? "n/a"}% |`)
    .join("\n");
  return `# ${city} Residential Market Summary

Window: ${windowLabel(r)}. Closed residential sales from california_sold.${r.coverage.yoy_available ? "" : " Year-over-year figures are unavailable because the data does not reach back a full year."}${r.window_change?.median_price_pct != null ? ` Median price changed ${pct(r.window_change.median_price_pct)} from ${r.window_change.from} to ${r.window_change.to} (full months).` : ""}

## Key metrics

| Metric | Value | Year-over-year |
|---|---|---|
| Closed sales | ${c.sold_count} | ${pct(r.yoy.sales_pct)} |
| Median close price | ${fmtMoney(c.median_close_price)} | ${pct(r.yoy.median_price_pct)} |
| Average close price | ${fmtMoney(c.avg_close_price)} | |
| Median price per sq ft | ${fmtMoney(c.median_price_per_sqft)} | ${pct(r.yoy.median_ppsf_pct)} |
| Median days on market (DOM) | ${c.median_dom ?? "n/a"} | ${r.yoy.median_dom_change ?? "n/a"} days |
| Average days on market | ${c.avg_dom ?? "n/a"} | |
| List-to-close ratio | ${c.list_to_close_pct ?? "n/a"}% | |
| Original-list-to-close ratio | ${c.orig_list_to_close_pct ?? "n/a"}% | |
| Share sold at or above list | ${c.pct_at_or_above_list ?? "n/a"}% | |
| Active listings (rets_property snapshot) | ${r.inventory.active_count} | |
| Months of supply | ${r.inventory.months_of_supply ?? "n/a"} | |

## Market read

${read.label}${read.reasons.length ? `: ${read.reasons.join(", ")}.` : "."}

## Monthly trend

| Month | Sales | Median price | MoM | Avg $/sqft | Avg DOM | List-to-close |
|---|---|---|---|---|---|---|
${trendRows}
`;
}

async function main() {
  const cities = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_CITIES;
  const outDir = "docs/market_reports";
  mkdirSync(outDir, { recursive: true });

  for (const city of cities) {
    const report = await getMarketReport({ city, zip: null, subType: null, months: 12 });
    if (report.current.sold_count === 0) {
      console.log(`skip ${city}: no sales in window`);
      continue;
    }
    const file = `${outDir}/${city.toLowerCase().replace(/[^a-z0-9]+/g, "_")}.md`;
    writeFileSync(file, toMarkdown(city, report));
    console.log(`wrote ${file} (${report.current.sold_count} sales)`);
  }
  await closeConnection();
}

main().catch(async (err) => {
  console.error(err);
  await closeConnection();
  process.exit(1);
});
