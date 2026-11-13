import { query } from "../db/connection.ts";
import { fromBlob, toBlob } from "./vectorMath.ts";

/**
 * Week 6 — vector storage in MySQL.
 *
 * MySQL 8.4 has no vector type, so each embedding is a BLOB of float32s
 * (768 dims × 4 bytes ≈ 3 KB). Search loads every vector for the current
 * model into one flat Float32Array (55K listings × 768 ≈ 170 MB) and scores
 * them in memory. That's simple and fast at this size; a vector database
 * only becomes worth it at millions of rows.
 */

export async function ensureEmbeddingTable() {
  // Mirror rets_property.L_ListingID's exact type/charset/collation so joins
  // between the two tables never hit "Illegal mix of collations".
  const cols = await query<{ COLUMN_TYPE: string; CHARACTER_SET_NAME: string | null; COLLATION_NAME: string | null }>(
    `SELECT COLUMN_TYPE, CHARACTER_SET_NAME, COLLATION_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rets_property' AND COLUMN_NAME = 'L_ListingID'`,
  );
  const c = cols[0];
  const idType = c
    ? `${c.COLUMN_TYPE}${c.CHARACTER_SET_NAME ? ` CHARACTER SET ${c.CHARACTER_SET_NAME} COLLATE ${c.COLLATION_NAME}` : ""}`
    : "VARCHAR(64)";
  if (!/^[\w() ,]+$/.test(idType)) throw new Error(`Unexpected L_ListingID column type: ${idType}`);
  await query(`
    CREATE TABLE IF NOT EXISTS listing_embeddings (
      L_ListingID ${idType}  NOT NULL,
      model       VARCHAR(64)  NOT NULL,
      dims        SMALLINT     NOT NULL,
      text_hash   CHAR(40)     NOT NULL,
      embedding   MEDIUMBLOB   NOT NULL,
      updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (L_ListingID),
      KEY idx_model_dims (model, dims)
    ) CHARACTER SET utf8mb4`);
}

export interface EmbeddingRecord {
  id: string;
  textHash: string;
  vector: Float32Array;
}

export async function upsertEmbeddings(model: string, dims: number, rows: EmbeddingRecord[]) {
  if (rows.length === 0) return;
  const placeholders = rows.map(() => "(?, ?, ?, ?, ?)").join(", ");
  const params = rows.flatMap((r) => [r.id, model, dims, r.textHash, toBlob(r.vector)]);
  await query(
    `INSERT INTO listing_embeddings (L_ListingID, model, dims, text_hash, embedding)
     VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE model = VALUES(model), dims = VALUES(dims),
       text_hash = VALUES(text_hash), embedding = VALUES(embedding)`,
    params,
  );
}

export async function countEmbeddings(model: string, dims: number): Promise<number> {
  const rows = await query<{ n: unknown }>(
    "SELECT COUNT(*) AS n FROM listing_embeddings WHERE model = ? AND dims = ?",
    [model, dims],
  );
  return Number(rows[0]?.n ?? 0);
}

// ---------------------------------------------------------------------------
// In-memory index
// ---------------------------------------------------------------------------
export interface VectorIndex {
  model: string;
  dims: number;
  ids: string[];
  rowOf: Map<string, number>;
  matrix: Float32Array; // row-major, ids.length × dims
}

let cached: VectorIndex | null = null;

/**
 * Load (or reuse) the in-memory index. Reloads automatically when the number
 * of stored embeddings changes, e.g. while the indexer is still running.
 */
export async function loadVectorIndex(model: string, dims: number): Promise<VectorIndex> {
  const n = await countEmbeddings(model, dims);
  if (cached && cached.model === model && cached.dims === dims && cached.ids.length === n) {
    return cached;
  }
  const ids: string[] = [];
  const matrix = new Float32Array(n * dims);
  const pageSize = 5000;
  let lastId = "";
  // Keyset pagination keeps each result set small.
  for (;;) {
    const rows = await query<{ L_ListingID: string; embedding: Buffer }>(
      `SELECT L_ListingID, embedding FROM listing_embeddings
        WHERE model = ? AND dims = ? AND L_ListingID > ?
        ORDER BY L_ListingID LIMIT ${pageSize}`,
      [model, dims, lastId],
    );
    for (const r of rows) {
      if (ids.length >= n) break; // rows added mid-load are picked up next time
      matrix.set(fromBlob(r.embedding), ids.length * dims);
      ids.push(String(r.L_ListingID));
    }
    if (rows.length < pageSize || ids.length >= n) break;
    lastId = String(rows[rows.length - 1]!.L_ListingID);
  }
  const trimmed = ids.length === n ? matrix : matrix.subarray(0, ids.length * dims);
  cached = { model, dims, ids, rowOf: new Map(ids.map((id, i) => [id, i])), matrix: trimmed };
  return cached;
}

export function getVector(index: VectorIndex, id: string): Float32Array | null {
  const row = index.rowOf.get(id);
  if (row === undefined) return null;
  return index.matrix.subarray(row * index.dims, (row + 1) * index.dims);
}
