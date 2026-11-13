import dotenv from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Every setting in one place. Modules read `config` instead of process.env.
 *
 * Where values come from, highest priority first:
 *   1. the project's .env file (repo root)
 *   2. the process environment
 *   3. the defaults below
 *
 * The .env file wins over the process environment on purpose: inside OpenClaw
 * the Gateway process can inherit unrelated MYSQL_* / GEMINI_* variables, and
 * this project's .env must not be overridden by them. The file is parsed into
 * our own map; process.env is never modified, so OpenClaw is unaffected.
 *
 * Values are read when accessed (getters), so loading the .env later, as the
 * OpenClaw plugin does once it knows its install folder, still takes effect.
 */

let fileEnv: Record<string, string> = {};
let loadedEnvPath: string | null = null;

/** Load (or reload) a .env file. Returns false if it doesn't exist. */
export function loadEnvFile(path: string | null | undefined): boolean {
  if (!path || !existsSync(path)) return false;
  fileEnv = dotenv.parse(readFileSync(path));
  loadedEnvPath = path;
  return true;
}

/** Path of the .env that is in effect, or null if none was found. */
export function envFilePath(): string | null {
  return loadedEnvPath;
}

/** The repo-root .env next to this source tree (null if it can't be located). */
function defaultEnvPath(): string | null {
  try {
    return fileURLToPath(new URL("../.env", import.meta.url));
  } catch {
    return null;
  }
}

// Scripts and tests: IDX_ENV_PATH, else <repo>/.env, else ./.env.
// The OpenClaw plugin calls loadEnvFile() again with its real install path,
// because OpenClaw runs a copy of the code from its own temp folder.
loadEnvFile(process.env.IDX_ENV_PATH) || loadEnvFile(defaultEnvPath()) || loadEnvFile(".env");

function get(name: string): string | undefined {
  const v = fileEnv[name] ?? process.env[name];
  return v === "" ? undefined : v;
}

function num(name: string, fallback: number): number {
  const raw = get(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got "${raw}"`);
  return n;
}

export const config = {
  get mysql() {
    return {
      host: get("MYSQL_HOST") || "127.0.0.1",
      port: num("MYSQL_PORT", 3306),
      user: get("MYSQL_USER") || "root",
      password: fileEnv.MYSQL_PASSWORD ?? process.env.MYSQL_PASSWORD ?? "",
      database: get("MYSQL_DATABASE") || "idx_exchange",
    };
  },
  get market() {
    // Optional YYYY-MM-DD that pins the end of market-stats windows.
    return { anchorDate: get("MARKET_ANCHOR_DATE") ?? null };
  },
  get embeddings() {
    return {
      model: get("GEMINI_EMBED_MODEL") || "gemini-embedding-2",
      dims: num("EMBED_DIMS", 768),
      maxRemarkChars: num("EMBED_MAX_REMARK_CHARS", 1000),
      tokensPerMinute: num("EMBED_TPM", 25_000),
      requestsPerMinute: num("EMBED_RPM", 90),
    };
  },
};

export function requireGeminiKey(): string {
  const key = get("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY is not set in .env");
  return key;
}
