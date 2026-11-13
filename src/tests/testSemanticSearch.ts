/**
 * Week 6 live test — needs MySQL, a Gemini key, and some embedded listings.
 *   npm run embed:listings -- --city Pasadena --city "San Diego" --city Irvine
 *   node src/tests/testSemanticSearch.ts
 */
import { closeConnection, query } from "../db/connection.ts";
import { EMBED_DIMS, EMBED_MODEL, embedBatch } from "../embeddings/gemini.ts";
import { buildListingText, listingTitle, type ListingTextRow } from "../embeddings/listingText.ts";
import { getVector, loadVectorIndex } from "../embeddings/store.ts";
import { rankBySimilarity, semanticSearch, semanticSearchAgent } from "../skills/semanticSearch.ts";
import { handleOpenClawPayload } from "../index.ts";
import { cosine } from "../embeddings/vectorMath.ts";

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.error(`  ✗ ${msg}`); failures++; }
}

const queries = [
  "charming craftsman with mountain views and character", // handbook example
  "modern home with an open floor plan, lots of natural light and a big backyard",
  "cozy beach cottage close to the ocean",
  "Spanish style house in Pasadena with a courtyard under $2M",
  "luxury condo with resort-style amenities and a gym",
];

async function run() {
  const index = await loadVectorIndex(EMBED_MODEL, EMBED_DIMS);
  console.log(`Index: ${index.ids.length.toLocaleString()} listings · ${EMBED_MODEL} · ${EMBED_DIMS} dims\n`);
  if (index.ids.length === 0) {
    console.error("No embeddings yet. Run: npm run embed:listings -- --city Pasadena");
    await closeConnection();
    process.exit(1);
  }

  for (const q of queries) {
    console.log(`\n================ User: "${q}"`);
    const res = await semanticSearchAgent(q, "semantic_test_user");
    console.log(res.response);
    check(res.status === "success", "returned results");
  }

  console.log("\n================ Checks");
  const r = await semanticSearch(queries[0]!);
  check(r.results.length === Math.min(5, r.indexed), `top 5 returned (${r.results.length})`);
  check(r.results.every((h, i) => i === 0 || r.results[i - 1]!.score >= h.score), "results sorted by similarity");
  check(r.results.every((h) => h.score > 0 && h.score <= 1.0001), "similarities in (0, 1]");

  const filtered = await semanticSearch("Spanish style house in Pasadena with a courtyard under $2M");
  check(filtered.filters.city === "Pasadena" && filtered.filters.maxPrice === 2_000_000, "parser filters applied (Pasadena, ≤ $2M)");
  check(filtered.results.every((h) => h.L_City === "Pasadena" && Number(h.price) <= 2_000_000), "every result respects the hard filters");

  // Self-retrieval: a listing's own description should find that listing first.
  const someId = index.ids[Math.floor(index.ids.length / 2)]!;
  const [row] = await query<ListingTextRow>(
    `SELECT L_ListingID, L_Type_, L_City, L_Keyword2, LM_Dec_3, LM_Int2_3, YearBuilt, L_SystemPrice,
            ArchitecturalStyle, View, PoolPrivateYN, AssociationAmenities, SubdivisionName, L_Remarks
       FROM rets_property WHERE L_ListingID = ?`,
    [someId],
  );
  if (row) {
    const { vectors } = await embedBatch([{ text: buildListingText(row), title: listingTitle(row) }], "document");
    const stored = getVector(index, someId)!;
    check(cosine(vectors[0]!, stored) > 0.99, `re-embedding a listing reproduces its stored vector (cos ${cosine(vectors[0]!, stored).toFixed(4)})`);
    // Top 3, not top 1: MLS data often has the same home listed twice with identical text.
    const top = rankBySimilarity(index, vectors[0]!, 3);
    check(top.some((t) => t.id === someId), `listing ${someId} retrieves itself in the top 3`);
  }

  console.log("\n================ Router");
  const routed = await handleOpenClawPayload({ message: queries[0], userId: "router6" });
  check(routed.intent === "semantic_search", "descriptive query → semanticSearchAgent");
  const structured = await handleOpenClawPayload({ message: "Find homes in Irvine", userId: "router6b" });
  check(structured.intent !== "semantic_search", "structured query → Week 4 search");
  const market = await handleOpenClawPayload({ message: "Are prices rising in Irvine?", userId: "router6c" });
  check(market.intent === "market_stats", "market question → Week 5 agent");

  console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
  await closeConnection();
  if (failures) process.exit(1);
}

run().catch(async (e) => {
  console.error(e);
  await closeConnection();
  process.exit(1);
});
