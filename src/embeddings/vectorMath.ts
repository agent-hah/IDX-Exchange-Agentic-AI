/**
 * Week 6 — small vector helpers.
 * All stored vectors are L2-normalized, so cosine similarity is a plain dot product.
 */

export function normalize(v: ArrayLike<number>): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i]! * v[i]!;
  const norm = Math.sqrt(sum) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i]! / norm;
  return out;
}

/** Dot product of a against row `row` of a flat row-major matrix. */
export function dotRow(a: Float32Array, matrix: Float32Array, row: number, dims: number): number {
  let s = 0;
  const off = row * dims;
  for (let i = 0; i < dims; i++) s += a[i]! * matrix[off + i]!;
  return s;
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Float32 vector → little-endian bytes for a MySQL BLOB column. */
export function toBlob(v: Float32Array): Buffer {
  const buf = Buffer.alloc(v.length * 4);
  for (let i = 0; i < v.length; i++) buf.writeFloatLE(v[i]!, i * 4);
  return buf;
}

/** BLOB bytes → Float32 vector (copies, so Buffer alignment never matters). */
export function fromBlob(buf: Buffer | Uint8Array): Float32Array {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const out = new Float32Array(b.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = b.readFloatLE(i * 4);
  return out;
}

/** Keep the k highest-scoring items without sorting everything. */
export function topK<T>(items: Iterable<{ item: T; score: number }>, k: number) {
  const best: { item: T; score: number }[] = [];
  for (const x of items) {
    if (best.length < k) {
      best.push(x);
      best.sort((a, b) => b.score - a.score);
    } else if (x.score > best[best.length - 1]!.score) {
      best[best.length - 1] = x;
      best.sort((a, b) => b.score - a.score);
    }
  }
  return best;
}
