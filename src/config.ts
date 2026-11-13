import "dotenv/config";

/**
 * Every environment setting in one place. Modules import `config` instead of
 * reading process.env directly, so the full list of knobs lives here.
 */

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got "${raw}"`);
  return n;
}

export const config = {
  mysql: {
    host: process.env.MYSQL_HOST || "127.0.0.1",
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD ?? "",
    database: process.env.MYSQL_DATABASE || "idx_exchange",
  },
  market: {
    // Optional YYYY-MM-DD that pins the end of market-stats windows.
    anchorDate: process.env.MARKET_ANCHOR_DATE || null,
  },
  embeddings: {
    model: process.env.GEMINI_EMBED_MODEL || "gemini-embedding-2",
    dims: num("EMBED_DIMS", 768),
    maxRemarkChars: num("EMBED_MAX_REMARK_CHARS", 1000),
    tokensPerMinute: num("EMBED_TPM", 25_000),
    requestsPerMinute: num("EMBED_RPM", 90),
  },
} as const;

/** Read lazily so tests and scripts that never call Gemini don't need a key. */
export function requireGeminiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set in .env");
  return key;
}
