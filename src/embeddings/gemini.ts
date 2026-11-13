import { config, requireGeminiKey } from "../config.ts";
import { normalize } from "./vectorMath.ts";

/**
 * Week 6 — Gemini embedding client (plain fetch, no SDK).
 *
 * Model: gemini-embedding-2 by default. It has no task_type parameter;
 * instead the text carries a task prefix:
 *   documents: "title: <title> | text: <content>"
 *   queries:   "task: search result | query: <content>"
 * gemini-embedding-001 is also supported (it uses taskType instead).
 *
 * The free tier is limited mostly by tokens per minute, so every request goes
 * through a sliding-window limiter, and 429s are retried using the server's
 * suggested delay. A per-day quota error is surfaced as DailyQuotaError so the
 * indexer can stop cleanly and resume later.
 */

export const EMBED_MODEL = config.embeddings.model;
export const EMBED_DIMS = config.embeddings.dims;
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const MAX_BATCH = 100; // requests per batchEmbedContents call

// Free-tier defaults with headroom; raise these if you're on a paid tier.
// Read per call so a .env loaded after import still applies.
const tpmLimit = () => config.embeddings.tokensPerMinute;
const rpmLimit = () => config.embeddings.requestsPerMinute;

export type EmbedKind = "query" | "document";

export class DailyQuotaError extends Error {}

/** Rough token estimate (~4 chars per token for English). */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4) + 4;

function formatInput(text: string, kind: EmbedKind, title?: string): string {
  if (!EMBED_MODEL.startsWith("gemini-embedding-2")) return text; // 001 uses taskType
  return kind === "query"
    ? `task: search result | query: ${text}`
    : `title: ${title?.trim() || "none"} | text: ${text}`;
}

// ---------------------------------------------------------------------------
// Sliding-window rate limiter (per process)
// ---------------------------------------------------------------------------
const window: { t: number; tokens: number }[] = [];

async function waitForCapacity(tokens: number) {
  for (;;) {
    const now = Date.now();
    while (window.length && now - window[0]!.t > 60_000) window.shift();
    const used = window.reduce((s, w) => s + w.tokens, 0);
    if (window.length < rpmLimit() && (used + tokens <= tpmLimit() || window.length === 0)) {
      window.push({ t: now, tokens });
      return;
    }
    const waitMs = window.length ? 60_000 - (now - window[0]!.t) + 50 : 1000;
    await sleep(Math.max(250, waitMs));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseRetryDelayMs(body: any): number | null {
  const details: any[] = body?.error?.details ?? [];
  const info = details.find((d) => String(d["@type"] ?? "").endsWith("RetryInfo"));
  const m = String(info?.retryDelay ?? "").match(/^([\d.]+)s$/);
  return m ? Math.ceil(Number(m[1]) * 1000) : null;
}

function isDailyQuota(body: any): boolean {
  const details: any[] = body?.error?.details ?? [];
  return details.some((d) =>
    (d.violations ?? []).some((v: any) => /PerDay/i.test(String(v.quotaId ?? v.quotaMetric ?? ""))),
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export interface EmbedInput {
  text: string;
  title?: string;
}

/**
 * Embed up to 100 texts in one request. Returns L2-normalized vectors of
 * length EMBED_DIMS, in input order, plus the token count Gemini reports.
 */
export async function embedBatch(
  inputs: EmbedInput[],
  kind: EmbedKind,
): Promise<{ vectors: Float32Array[]; tokens: number }> {
  if (inputs.length === 0) return { vectors: [], tokens: 0 };
  if (inputs.length > MAX_BATCH) throw new Error(`embedBatch: max ${MAX_BATCH} inputs per call`);
  const apiKey = requireGeminiKey();

  const texts = inputs.map((i) => formatInput(i.text, kind, i.title));
  const estTokens = texts.reduce((s, t) => s + estimateTokens(t), 0);
  const config: Record<string, unknown> = { outputDimensionality: EMBED_DIMS };
  if (!EMBED_MODEL.startsWith("gemini-embedding-2")) {
    config.taskType = kind === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT";
  }
  const body = JSON.stringify({
    requests: texts.map((text) => ({
      model: `models/${EMBED_MODEL}`,
      content: { parts: [{ text }] },
      embedContentConfig: config,
    })),
  });

  for (let attempt = 0; ; attempt++) {
    await waitForCapacity(estTokens);
    const res = await fetch(`${API_BASE}/models/${EMBED_MODEL}:batchEmbedContents`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body,
    });
    const json: any = await res.json().catch(() => ({}));

    if (res.ok) {
      const embs: any[] = json.embeddings ?? [];
      if (embs.length !== inputs.length) {
        throw new Error(`Gemini returned ${embs.length} embeddings for ${inputs.length} inputs`);
      }
      // If the dimension setting were ignored, truncating a Matryoshka-style
      // embedding and re-normalizing is still valid.
      const vectors = embs.map((e) => normalize((e.values as number[]).slice(0, EMBED_DIMS)));
      if (vectors.some((v) => v.length !== EMBED_DIMS)) {
        throw new Error(`Expected ${EMBED_DIMS}-dim embeddings, got ${vectors[0]?.length}`);
      }
      return { vectors, tokens: Number(json.usageMetadata?.promptTokenCount ?? estTokens) };
    }

    const retryable = res.status === 429 || res.status >= 500;
    if (res.status === 429 && isDailyQuota(json)) {
      throw new DailyQuotaError("Gemini daily embedding quota reached. Re-run later; indexing resumes where it stopped.");
    }
    if (!retryable || attempt >= 8) {
      const msg = json?.error?.message ?? res.statusText;
      throw new Error(`Gemini embeddings ${res.status}: ${msg}`);
    }
    const delay = parseRetryDelayMs(json) ?? Math.min(120_000, 5_000 * 2 ** attempt);
    console.warn(`  Gemini ${res.status}; retrying in ${Math.round(delay / 1000)}s (attempt ${attempt + 1})`);
    await sleep(delay);
  }
}

/** Embed a single search query. */
export async function embedQuery(text: string): Promise<Float32Array> {
  const { vectors } = await embedBatch([{ text }], "query");
  return vectors[0]!;
}
