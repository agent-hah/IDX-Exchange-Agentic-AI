import { parseMarketQuery } from "./marketParser.ts";
import {
  addDays,
  getMarketReport,
  getCityLeaderboard,
  type MarketFilters,
  type MarketReport,
} from "./marketQueries.ts";
import { getSession } from "../memory/session.ts";

const shiftDay = (d: string) => addDays(d, 1);

/**
 * Week 5 — marketStatsAgent.
 * Answers market questions with data-backed summaries from california_sold:
 * median price, DOM, list-to-close ratio, YoY change and a monthly trend.
 * Returns the raw report in `data` so the Week 9 orchestrator and the Week 8
 * RAG indexer can reuse it.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtMoney(n: number | null): string {
  if (n === null) return "n/a";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 10_000) return `$${Math.round(n / 1000)}K`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function fmtPct(n: number | null, signed = true): string {
  if (n === null) return "n/a";
  return `${signed && n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function fmtMonth(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MONTHS[Number(m) - 1] ?? m} ${y?.slice(2)}`;
}

function fmtDate(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${MONTHS[Number(m) - 1]} ${Number(d)}, ${y}`;
}

const SUBTYPE_LABEL: Record<string, string> = {
  Condominium: "Condos",
  Townhouse: "Townhomes",
  SingleFamilyResidence: "Single-family homes",
};

export function describeLocation(f: MarketFilters): string {
  const place = f.city && f.zip ? `${f.city} (${f.zip})` : f.city ?? (f.zip ? `ZIP ${f.zip}` : "California");
  return f.subType ? `${place} · ${SUBTYPE_LABEL[f.subType] ?? f.subType}` : place;
}

/**
 * Simple, explainable market-temperature read. Each signal votes
 * seller (+1) / buyer (-1); thresholds are common rules of thumb.
 */
export function marketRead(r: MarketReport): { label: string; reasons: string[] } {
  // Each signal votes seller (+1) or buyer (-1). Only reasons that agree with
  // the final label are shown, so the one-liner doesn't contradict itself.
  const votes: { side: 1 | -1; text: string }[] = [];
  const ltc = r.current.list_to_close_pct;
  const dom = r.current.median_dom;
  const mos = r.inventory.months_of_supply;

  if (ltc !== null) {
    if (ltc >= 100) votes.push({ side: 1, text: `homes closing at ${ltc}% of list` });
    else if (ltc <= 97) votes.push({ side: -1, text: `buyers negotiating ~${(100 - ltc).toFixed(1)}% off list` });
  }
  if (dom !== null) {
    if (dom <= 21) votes.push({ side: 1, text: `a typical home sells in ${dom} days` });
    else if (dom >= 45) votes.push({ side: -1, text: `a typical home sits ${dom} days` });
  }
  if (mos !== null && r.inventory.active_count > 0) {
    if (mos < 3) votes.push({ side: 1, text: `only ~${mos} months of supply` });
    else if (mos > 6) votes.push({ side: -1, text: `~${mos} months of supply` });
  }

  const score = votes.reduce((s, v) => s + v.side, 0);
  const label =
    score >= 2 ? "Seller's market" : score <= -2 ? "Buyer's market" : score === 1 ? "Leaning seller's market" : score === -1 ? "Leaning buyer's market" : "Balanced market";
  const reasons = score === 0 ? [] : votes.filter((v) => Math.sign(score) === v.side).map((v) => v.text);

  // Price direction is context, not a vote.
  const yoy = r.yoy.median_price_pct;
  if (yoy !== null && Math.abs(yoy) >= 3) reasons.push(`median price ${fmtPct(yoy)} YoY`);
  return { label, reasons };
}

/** " · +4.2% YoY", or "" when there is no comparable prior-year data. */
const yoyTag = (n: number | null) => (n === null ? "" : ` · ${fmtPct(n)} YoY`);

export function windowLabel(r: MarketReport): string {
  if (r.coverage.truncated) {
    return `${fmtDate(r.coverage.first_day)} – ${fmtDate(r.window.end)} (~${r.coverage.covered_months} mo; data starts ${fmtDate(r.coverage.data_start)})`;
  }
  return `${r.filters.months} mo ending ${fmtDate(r.window.end)}`;
}

export function formatReportForWhatsApp(r: MarketReport): string {
  const c = r.current;
  const lines: string[] = [];
  lines.push(`📊 *${describeLocation(r.filters)} — Market Snapshot*`);
  lines.push(`_Residential closed sales, ${windowLabel(r)}_`);
  lines.push("");
  lines.push(`🏷 Sales: ${c.sold_count.toLocaleString("en-US")} closed${r.yoy.sales_pct === null ? "" : ` (${fmtPct(r.yoy.sales_pct)} YoY)`}`);
  lines.push(`💰 Median price: ${fmtMoney(c.median_close_price)} (avg ${fmtMoney(c.avg_close_price)})${yoyTag(r.yoy.median_price_pct)}`);
  lines.push(`📐 Price/sqft: ${fmtMoney(c.median_price_per_sqft)} median (avg ${fmtMoney(c.avg_price_per_sqft)})${yoyTag(r.yoy.median_ppsf_pct)}`);
  const domDelta =
    r.yoy.median_dom_change === null ? "" : ` · ${r.yoy.median_dom_change > 0 ? "+" : ""}${r.yoy.median_dom_change} days YoY`;
  lines.push(`📅 Days on market: ${c.median_dom ?? "n/a"} median (avg ${c.avg_dom ?? "n/a"})${domDelta}`);
  lines.push(
    `🤝 List-to-close: ${fmtPct(c.list_to_close_pct, false)} · orig. list-to-close ${fmtPct(c.orig_list_to_close_pct, false)} · ${fmtPct(c.pct_at_or_above_list, false)} sold at/above list`,
  );
  if (r.inventory.active_count > 0) {
    lines.push(`🏘 Inventory: ${r.inventory.active_count.toLocaleString("en-US")} active · ~${r.inventory.months_of_supply ?? "n/a"} months of supply`);
  }

  const trend = r.trend.slice(-12);
  if (trend.length > 1) {
    lines.push("");
    lines.push(`📈 *Monthly median price${r.trend.length > 12 ? " (last 12 mo)" : ""}*`);
    for (const p of trend) {
      const mom = p.mom_change_pct === null ? "" : ` (${fmtPct(p.mom_change_pct)})`;
      const tag = p.partial ? " _(partial)_" : "";
      lines.push(`${fmtMonth(p.month)}${tag}: ${fmtMoney(p.median_price)}${mom} · ${p.sales} sales · ${p.avg_dom ?? "n/a"}d DOM`);
    }
    if (r.yoy.median_price_pct === null && r.window_change?.median_price_pct != null) {
      lines.push(
        `Median ${fmtPct(r.window_change.median_price_pct)} from ${fmtMonth(r.window_change.from)} to ${fmtMonth(r.window_change.to)} (full months only)`,
      );
    }
  }

  const read = marketRead(r);
  lines.push("");
  lines.push(`🧭 *Read: ${read.label}*${read.reasons.length ? ` — ${read.reasons.join(", ")}.` : ""}`);
  lines.push(`_Source: california_sold. Inventory is the current rets_property snapshot. Market data, not financial advice._`);
  return lines.join("\n");
}

export async function marketStatsAgent(message: string, userId?: string) {
  try {
    const filters = parseMarketQuery(message);

    // Multi-turn: "how's the market there?" reuses the city from the search session.
    if (!filters.city && !filters.zip && userId) {
      const sessionCity = getSession(userId).city;
      if (sessionCity) filters.city = sessionCity;
    }

    // No location → statewide leaderboard instead of a dead-end question.
    if (!filters.city && !filters.zip) {
      const { window, rows } = await getCityLeaderboard(filters.months, 10);
      if (rows.length === 0) {
        return { status: "empty", intent: "market_stats", response: "I couldn't find any closed residential sales in the data window." };
      }
      const body = rows
        .map(
          (r, i) =>
            `${i + 1}. *${r.City}* — ${r.sold_count.toLocaleString("en-US")} sales · avg ${fmtMoney(r.avg_close_price)} · ${fmtMoney(r.avg_price_per_sqft)}/sqft · ${r.avg_dom ?? "n/a"}d DOM · ${fmtPct(r.list_to_close_pct, false)} L/C`,
        )
        .join("\n");
      return {
        status: "success",
        intent: "market_stats",
        data: { leaderboard: rows, window },
        response: `📊 *Most active CA markets* (${window.first_day > shiftDay(window.start) ? `${fmtDate(window.first_day)} – ${fmtDate(window.end)}` : `${filters.months} mo ending ${fmtDate(window.end)}`})\n\n${body}\n\nAsk about a specific city or ZIP for the full breakdown, e.g. "Is now a good time to buy in San Diego?"`,
      };
    }

    const report = await getMarketReport(filters);
    if (report.current.sold_count === 0) {
      return {
        status: "empty",
        intent: "market_stats",
        data: report,
        response: `I couldn't find closed residential sales for ${describeLocation(filters)} in ${windowLabel(report)}. Check the spelling, or try a nearby city or ZIP code.`,
      };
    }

    const thin = report.current.sold_count < 10 ? `\n\n⚠️ Only ${report.current.sold_count} sales in this window, so treat these numbers as rough.` : "";
    return {
      status: "success",
      intent: "market_stats",
      data: report,
      response: formatReportForWhatsApp(report) + thin,
    };
  } catch (error) {
    console.error("Market Stats Skill Error:", error);
    return {
      status: "error",
      intent: "market_stats",
      response: "Sorry, I hit an issue while pulling market data. Please try again.",
    };
  }
}
