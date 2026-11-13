/** Shared number/money/date formatting for agent replies. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Full dollars: 1250000 → "$1,250,000". */
export function fmtPrice(n: number | string | null | undefined): string {
  return `$${Number(n ?? 0).toLocaleString("en-US")}`;
}

/** Compact dollars: 1450000 → "$1.45M", 845000 → "$845K", 812 → "$812". */
export function fmtMoney(n: number | null): string {
  if (n === null) return "n/a";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 10_000) return `$${Math.round(n / 1000)}K`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** "+4.2%" (signed) or "98.0%". */
export function fmtPct(n: number | null, signed = true): string {
  if (n === null) return "n/a";
  return `${signed && n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

/** 1234 → "1,234". */
export function fmtInt(n: number | string | null | undefined): string {
  return Number(n ?? 0).toLocaleString("en-US");
}

/** "2026-09" → "Sep 26". */
export function fmtMonth(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MONTHS[Number(m) - 1] ?? m} ${y?.slice(2)}`;
}

/** "2026-09-17" → "Sep 17, 2026". */
export function fmtDate(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${MONTHS[Number(m) - 1]} ${Number(d)}, ${y}`;
}
