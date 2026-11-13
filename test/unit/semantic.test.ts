import { test } from "node:test";
import assert from "node:assert/strict";
import { descriptiveWords, isSemanticQuery } from "../../src/agents/semanticSearch/intent.ts";
import { isMarketQuestion } from "../../src/agents/marketStats/parser.ts";
import { buildListingText, textHash, type ListingTextRow } from "../../src/embeddings/listingText.ts";
import { cosine, dotRow, fromBlob, normalize, toBlob, topK } from "../../src/embeddings/vectorMath.ts";

// --- Routing: which messages go to semantic search -------------------------
const routing: [string, boolean][] = [
  ["charming craftsman with mountain views and character", true],
  ["Modern home with an open floor plan and a big backyard in Pasadena", true],
  ["cozy beach cottage near the water under $2M", true],
  ["Spanish style house with a courtyard and original tile", true],
  ["something similar to a mid-century ranch", true],
  ["semantic: quiet", true],
  ["Show me 3-bedroom condos in Irvine under $1.5M with a pool", false],
  ["Find homes in Irvine", false],
  ["Find homes in Newport Beach", false],
  ["my maximum budget is 900k", false],
  ["Single family with at least 3 beds", false],
  ["I need 4 beds and 3 baths in Riverside", false],
  ["2 bed 1.5 bath condo in Pasadena under 750k", false],
  ["Under $1.2M", false],
];
for (const [q, expected] of routing) {
  test(`isSemanticQuery=${expected}: ${q}`, () => {
    assert.equal(isSemanticQuery(q), expected, `descriptive words: ${descriptiveWords(q).join(", ")}`);
  });
}

test("a descriptive query is not a market question", () => {
  assert.equal(isMarketQuestion("charming craftsman with mountain views and character"), false);
});

// --- Vector math ----------------------------------------------------------
test("normalize([3,4]) = [0.6, 0.8]", () => {
  const a = normalize([3, 4]);
  assert.ok(Math.abs(a[0]! - 0.6) < 1e-6 && Math.abs(a[1]! - 0.8) < 1e-6);
});

test("cosine: orthogonal = 0, parallel = 1", () => {
  assert.ok(Math.abs(cosine([1, 0], [0, 1])) < 1e-9);
  assert.ok(Math.abs(cosine([1, 1], [2, 2]) - 1) < 1e-9);
});

test("BLOB round-trip preserves float32 values, even from unaligned Buffers", () => {
  const v = normalize([0.1, -0.5, 0.25, 0.9]);
  const round = fromBlob(toBlob(v));
  assert.ok(round.every((x, i) => Math.abs(x - v[i]!) < 1e-7));
  const unaligned = Buffer.concat([Buffer.from([0]), toBlob(v)]).subarray(1);
  assert.ok(fromBlob(unaligned).every((x, i) => Math.abs(x - v[i]!) < 1e-7));
});

test("dotRow equals cosine for normalized rows", () => {
  const m = new Float32Array([...normalize([1, 0]), ...normalize([1, 1]), ...normalize([0, 1])]);
  assert.ok(Math.abs(dotRow(normalize([1, 0]), m, 1, 2) - Math.SQRT1_2) < 1e-6);
});

test("topK returns the best k in order", () => {
  const best = topK([5, 1, 9, 3, 7].map((s, i) => ({ item: i, score: s })), 3);
  assert.deepEqual(best.map((b) => b.score), [9, 7, 5]);
});

// --- Listing text -----------------------------------------------------------
const row: ListingTextRow = {
  L_ListingID: "1", L_Type_: "SingleFamilyResidence", L_City: "Pasadena", L_Keyword2: 3, LM_Dec_3: "2.0",
  LM_Int2_3: 1850, YearBuilt: 1924, L_SystemPrice: 1495000, ArchitecturalStyle: "Craftsman",
  View: "Mountain(s)", PoolPrivateYN: "False", AssociationAmenities: null, SubdivisionName: null,
  L_Remarks: "Charming   1920s craftsman &amp; original built-ins. " + "x".repeat(3000),
};

test("listing text: header and descriptive fields", () => {
  const text = buildListingText(row, 200);
  assert.ok(text.startsWith("Single Family Residence in Pasadena, CA. 3 beds, 2 baths, 1850 sq ft, built 1924."));
  assert.ok(text.includes("Style: Craftsman.") && text.includes("View: Mountain(s)."));
  assert.ok(!text.includes("Private pool"));
});

test("listing text: remarks cleaned and truncated", () => {
  const text = buildListingText(row, 200);
  assert.ok(text.includes("Charming 1920s craftsman & original built-ins."));
  assert.ok(text.split("\n")[1]!.length <= 200);
});

test("text hash is stable and changes when the text changes", () => {
  const text = buildListingText(row, 200);
  assert.equal(textHash(text), textHash(buildListingText(row, 200)));
  assert.notEqual(textHash(text), textHash(buildListingText(row, 300)));
});

// Guards the stored embeddings: if this hash changes, every listing would be re-embedded.
test("embedding text for a fixed listing is unchanged (protects existing embeddings)", () => {
  assert.equal(textHash(buildListingText(row, 1000)), GOLDEN_HASH);
});
const GOLDEN_HASH = "be6aaa59fc68adee70fe307d532e242d9ee53610";
