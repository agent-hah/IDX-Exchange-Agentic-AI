/**
 * Week 6 against the live database + Gemini. Needs some embedded listings
 * (works with a partial index while the indexer is still running).
 *   npm run test:semantic
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { closeConnection, query } from "../../src/db/connection.ts";
import { EMBED_DIMS, EMBED_MODEL, embedBatch } from "../../src/embeddings/gemini.ts";
import { buildListingText, listingTitle, type ListingTextRow } from "../../src/embeddings/listingText.ts";
import { getVector, loadVectorIndex, type VectorIndex } from "../../src/embeddings/store.ts";
import { cosine } from "../../src/embeddings/vectorMath.ts";
import { semanticSearchAgent } from "../../src/agents/semanticSearch/agent.ts";
import { rankBySimilarity, semanticSearch } from "../../src/agents/semanticSearch/search.ts";
import { route } from "../../src/index.ts";

let index: VectorIndex;
before(async () => {
  index = await loadVectorIndex(EMBED_MODEL, EMBED_DIMS);
  assert.ok(index.ids.length > 0, "No embeddings yet. Run: npm run embed:listings -- --city Pasadena");
  console.log(`Index: ${index.ids.length.toLocaleString()} listings · ${EMBED_MODEL} · ${EMBED_DIMS} dims`);
});
after(() => closeConnection());

const queries = [
  "charming craftsman with mountain views and character", // handbook example
  "modern home with an open floor plan, lots of natural light and a big backyard",
  "cozy beach cottage close to the ocean",
  "luxury condo with resort-style amenities and a gym",
];
for (const q of queries) {
  test(`agent answers: ${q}`, async () => {
    const r = await semanticSearchAgent(q, "it_semantic");
    assert.equal(r.status, "success", r.response);
    console.log(`\n${r.response}`);
  });
}

test("top 5, sorted, similarities in (0, 1]", async () => {
  const r = await semanticSearch(queries[0]!);
  assert.equal(r.results.length, Math.min(5, r.indexed));
  assert.ok(r.results.every((h, i) => i === 0 || r.results[i - 1]!.score >= h.score));
  assert.ok(r.results.every((h) => h.score > 0 && h.score <= 1.0001));
});

test("hard filters from the query are respected", async () => {
  const r = await semanticSearch("Spanish style house in Pasadena with a courtyard under $2M");
  assert.equal(r.filters.city, "Pasadena");
  assert.equal(r.filters.maxPrice, 2_000_000);
  assert.ok(r.results.every((h) => h.L_City === "Pasadena" && Number(h.price) <= 2_000_000));
});

test("re-embedding a stored listing reproduces its vector and retrieves itself", async () => {
  const id = index.ids[Math.floor(index.ids.length / 2)]!;
  const [row] = await query<ListingTextRow>(
    `SELECT L_ListingID, L_Type_, L_City, L_Keyword2, LM_Dec_3, LM_Int2_3, YearBuilt, L_SystemPrice,
            ArchitecturalStyle, View, PoolPrivateYN, AssociationAmenities, SubdivisionName, L_Remarks
       FROM rets_property WHERE L_ListingID = ?`,
    [id],
  );
  if (!row) throw new Error(`listing ${id} not found`);
  const { vectors } = await embedBatch([{ text: buildListingText(row), title: listingTitle(row) }], "document");
  assert.ok(cosine(vectors[0]!, getVector(index, id)!) > 0.99);
  // Top 3, not top 1: MLS data often lists the same home twice with identical text.
  assert.ok(rankBySimilarity(index, vectors[0]!, 3).some((t) => t.id === id));
});

test("router: descriptive → semantic, structured → search, market → market", async () => {
  assert.equal((await route(queries[0]!, "it_r1")).intent, "semantic_search");
  assert.equal((await route("Find homes in Irvine", "it_r2")).intent, "property_search");
  assert.equal((await route("Are prices rising in Irvine?", "it_r3")).intent, "market_stats");
});
