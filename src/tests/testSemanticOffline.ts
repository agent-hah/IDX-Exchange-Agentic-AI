/** Week 6 offline tests — no database or API key needed.  node src/tests/testSemanticOffline.ts */
import { isSemanticQuery, descriptiveWords } from "../skills/semanticIntent.ts";
import { isMarketQuestion } from "../skills/marketParser.ts";
import { normalize, cosine, dotRow, toBlob, fromBlob, topK } from "../embeddings/vectorMath.ts";
import { buildListingText, textHash, type ListingTextRow } from "../embeddings/listingText.ts";

let pass = 0;
let total = 0;
function check(cond: boolean, msg: string) {
  total++;
  if (cond) { pass++; console.log(`PASS ${msg}`); }
  else console.error(`FAIL ${msg}`);
}

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
  const got = isSemanticQuery(q);
  check(got === expected, `route semantic=${expected}: "${q}"${got !== expected ? ` (words: ${descriptiveWords(q).join(",")})` : ""}`);
}
check(!isMarketQuestion("charming craftsman with mountain views and character"), "descriptive query is not a market question");

// --- Vector math ----------------------------------------------------------
const a = normalize([3, 4]);
check(Math.abs(a[0]! - 0.6) < 1e-6 && Math.abs(a[1]! - 0.8) < 1e-6, "normalize([3,4]) = [0.6, 0.8]");
check(Math.abs(cosine([1, 0], [0, 1])) < 1e-9 && Math.abs(cosine([1, 1], [2, 2]) - 1) < 1e-9, "cosine orthogonal = 0, parallel = 1");
const v = normalize([0.1, -0.5, 0.25, 0.9]);
const round = fromBlob(toBlob(v));
check(round.length === 4 && round.every((x, i) => Math.abs(x - v[i]!) < 1e-7), "BLOB round-trip preserves float32 values");
const odd = Buffer.concat([Buffer.from([0]), toBlob(v)]).subarray(1); // unaligned offset
check(fromBlob(odd).every((x, i) => Math.abs(x - v[i]!) < 1e-7), "fromBlob works on unaligned Buffers");
const m = new Float32Array([...normalize([1, 0]), ...normalize([1, 1]), ...normalize([0, 1])]);
check(Math.abs(dotRow(normalize([1, 0]), m, 1, 2) - Math.SQRT1_2) < 1e-6, "dotRow == cosine for normalized rows");
const best = topK([5, 1, 9, 3, 7].map((s, i) => ({ item: i, score: s })), 3);
check(JSON.stringify(best.map((b) => b.score)) === "[9,7,5]", "topK returns best 3 in order");

// --- Listing text -----------------------------------------------------------
const row: ListingTextRow = {
  L_ListingID: "1", L_Type_: "SingleFamilyResidence", L_City: "Pasadena", L_Keyword2: 3, LM_Dec_3: "2.0",
  LM_Int2_3: 1850, YearBuilt: 1924, L_SystemPrice: 1495000, ArchitecturalStyle: "Craftsman",
  View: "Mountain(s)", PoolPrivateYN: "False", AssociationAmenities: null, SubdivisionName: null,
  L_Remarks: "Charming   1920s craftsman &amp; original built-ins. " + "x".repeat(3000),
};
const text = buildListingText(row, 200);
check(text.startsWith("Single Family Residence in Pasadena, CA. 3 beds, 2 baths, 1850 sq ft, built 1924."), "listing text header");
check(text.includes("Style: Craftsman.") && text.includes("View: Mountain(s).") && !text.includes("Private pool"), "listing text descriptive fields");
check(text.includes("Charming 1920s craftsman & original built-ins.") && text.split("\n")[1]!.length <= 200, "remarks cleaned and truncated");
check(textHash(text) === textHash(buildListingText(row, 200)) && textHash(text) !== textHash(buildListingText(row, 300)), "text hash stable and sensitive to changes");

console.log(`\nResults: ${pass}/${total} passed.`);
if (pass !== total) process.exit(1);
