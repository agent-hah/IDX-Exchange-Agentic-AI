/**
 * Week 6 — embed active rets_property listings into listing_embeddings.
 *
 *   node src/scripts/buildListingEmbeddings.ts --dry-run             # counts + time estimate, no API calls
 *   node src/scripts/buildListingEmbeddings.ts --city Pasadena --city Irvine
 *   node src/scripts/buildListingEmbeddings.ts --limit 500
 *   node src/scripts/buildListingEmbeddings.ts                       # everything (free tier: overnight)
 *
 * Options:
 *   --city <name>      only listings in this city (repeatable)
 *   --limit <n>        stop after embedding n listings
 *   --max-chars <n>    max characters of L_Remarks per listing (default 1000)
 *   --force            re-embed even if the text hasn't changed
 *   --dry-run          print what would be embedded and the estimated time
 *
 * Safe to stop (Ctrl-C) and re-run at any time: each batch is saved as soon
 * as it returns, and listings whose text is unchanged are skipped.
 */
import { closeConnection, query } from "../db/connection.ts";
import {
  DailyQuotaError,
  EMBED_DIMS,
  EMBED_MODEL,
  embedBatch,
  estimateTokens,
} from "../embeddings/gemini.ts";
import {
  buildListingText,
  DEFAULT_MAX_REMARK_CHARS,
  listingTitle,
  textHash,
  type ListingTextRow,
} from "../embeddings/listingText.ts";
import { ensureEmbeddingTable, upsertEmbeddings } from "../embeddings/store.ts";

// --------------------------------------------------------------------------
// CLI args
// --------------------------------------------------------------------------
const args = process.argv.slice(2);
const cities: string[] = [];
let limit = Infinity;
let maxChars = DEFAULT_MAX_REMARK_CHARS;
let force = false;
let dryRun = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--city") cities.push(args[++i] ?? "");
  else if (a === "--limit") limit = Number(args[++i]);
  else if (a === "--max-chars") maxChars = Number(args[++i]);
  else if (a === "--force") force = true;
  else if (a === "--dry-run") dryRun = true;
  else {
    console.error(`Unknown argument: ${a}`);
    process.exit(1);
  }
}

const TPM = Number(process.env.EMBED_TPM || 25_000);
// Keep each request well under the per-minute token budget.
const BATCH_TOKEN_BUDGET = Math.min(Math.floor(TPM / 2), 60_000);
const BATCH_MAX_ITEMS = 100;

let stopping = false;
process.on("SIGINT", () => {
  if (stopping) process.exit(130);
  stopping = true;
  console.log("\nStopping after the current batch (Ctrl-C again to quit immediately)...");
});

interface Pending {
  id: string;
  text: string;
  title: string;
  hash: string;
}

async function fetchPage(afterId: string, pageSize: number) {
  let sql = `
    SELECT r.L_ListingID, r.L_Type_, r.L_City, r.L_Keyword2, r.LM_Dec_3, r.LM_Int2_3,
           r.YearBuilt, r.L_SystemPrice, r.ArchitecturalStyle, r.View, r.PoolPrivateYN,
           r.AssociationAmenities, r.SubdivisionName, r.L_Remarks,
           e.text_hash AS existing_hash, e.model AS existing_model, e.dims AS existing_dims
      FROM rets_property r
      LEFT JOIN listing_embeddings e ON e.L_ListingID = r.L_ListingID
     WHERE r.L_Status = 'Active' AND r.L_ListingID > ?`;
  const params: (string | number)[] = [afterId];
  if (cities.length) {
    sql += ` AND r.L_City IN (${cities.map(() => "?").join(", ")})`;
    params.push(...cities);
  }
  sql += ` ORDER BY r.L_ListingID LIMIT ${pageSize}`;
  return query<ListingTextRow & { existing_hash: string | null; existing_model: string | null; existing_dims: number | null }>(sql, params);
}

/** Walk all matching listings and return the ones that need (re-)embedding. */
async function collectPending(): Promise<{ pending: Pending[]; total: number; upToDate: number }> {
  const pending: Pending[] = [];
  let total = 0;
  let upToDate = 0;
  let after = "";
  for (;;) {
    const rows = await fetchPage(after, 2000);
    for (const r of rows) {
      total++;
      const text = buildListingText(r, maxChars);
      const hash = textHash(text);
      const current =
        r.existing_hash === hash && r.existing_model === EMBED_MODEL && Number(r.existing_dims) === EMBED_DIMS;
      if (current && !force) {
        upToDate++;
        continue;
      }
      if (pending.length < limit) pending.push({ id: String(r.L_ListingID), text, title: listingTitle(r), hash });
    }
    if (rows.length < 2000) break;
    after = String(rows[rows.length - 1]!.L_ListingID);
  }
  return { pending, total, upToDate };
}

function fmtDuration(min: number): string {
  if (min < 1) return "under a minute";
  if (min < 90) return `~${Math.round(min)} min`;
  return `~${(min / 60).toFixed(1)} h`;
}

async function main() {
  await ensureEmbeddingTable();
  console.log(`Model ${EMBED_MODEL} · ${EMBED_DIMS} dims · remarks ≤ ${maxChars} chars · budget ${TPM.toLocaleString()} tokens/min`);
  if (cities.length) console.log(`Cities: ${cities.join(", ")}`);

  const { pending, total, upToDate } = await collectPending();
  const estTokens = pending.reduce((s, p) => s + estimateTokens(p.text) + 10, 0);
  console.log(
    `Active listings matched: ${total.toLocaleString()} · already embedded: ${upToDate.toLocaleString()} · to embed now: ${pending.length.toLocaleString()}`,
  );
  console.log(`Estimated ${estTokens.toLocaleString()} tokens → ${fmtDuration(estTokens / TPM)} at the current rate limit`);
  if (dryRun || pending.length === 0) {
    if (pending[0]) console.log(`\nSample embedding text:\n---\n${pending[0].text}\n---`);
    await closeConnection();
    return;
  }

  const started = Date.now();
  let done = 0;
  let tokensUsed = 0;
  let i = 0;
  try {
    while (i < pending.length && !stopping) {
      // Build a batch that fits the token budget.
      const batch: Pending[] = [];
      let batchTokens = 0;
      while (i < pending.length && batch.length < BATCH_MAX_ITEMS) {
        const t = estimateTokens(pending[i]!.text) + 10;
        if (batch.length && batchTokens + t > BATCH_TOKEN_BUDGET) break;
        batch.push(pending[i]!);
        batchTokens += t;
        i++;
      }
      const { vectors, tokens } = await embedBatch(
        batch.map((p) => ({ text: p.text, title: p.title })),
        "document",
      );
      await upsertEmbeddings(
        EMBED_MODEL,
        EMBED_DIMS,
        batch.map((p, k) => ({ id: p.id, textHash: p.hash, vector: vectors[k]! })),
      );
      done += batch.length;
      tokensUsed += tokens;
      const elapsedMin = (Date.now() - started) / 60_000;
      const rate = done / Math.max(elapsedMin, 1e-6);
      const etaMin = (pending.length - done) / Math.max(rate, 1e-6);
      process.stdout.write(
        `\r  ${done.toLocaleString()}/${pending.length.toLocaleString()} embedded · ${tokensUsed.toLocaleString()} tokens · ${Math.round(rate)}/min · ETA ${fmtDuration(etaMin)}   `,
      );
    }
    console.log(stopping ? `\nStopped. ${done} listings saved; re-run to continue.` : `\nDone. ${done} listings embedded.`);
  } catch (err) {
    if (err instanceof DailyQuotaError) {
      console.log(`\n${err.message} (${done} listings saved this run)`);
    } else {
      console.error(`\nFailed after ${done} listings (all of them are saved):`, err);
      process.exitCode = 1;
    }
  } finally {
    await closeConnection();
  }
}

main().catch(async (e) => {
  console.error(e);
  await closeConnection();
  process.exit(1);
});
