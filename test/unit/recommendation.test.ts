import { test } from "node:test";
import assert from "node:assert/strict";
import { priceScore, similarityScore, sqftScore } from "../../src/agents/recommendation/scoring.ts";
import { isRecommendationQuery, referencedPosition, resolveListingReference } from "../../src/agents/recommendation/intent.ts";
import { compVerdict } from "../../src/agents/recommendation/agent.ts";
import { isSemanticQuery } from "../../src/agents/semanticSearch/intent.ts";

// --- Scoring (handbook thresholds) ------------------------------------------
test("price points: <50K → 20, <150K → 12, <300K → 5, else 0", () => {
  assert.deepEqual([priceScore(1e6, 1.04e6), priceScore(1e6, 1.1e6), priceScore(1e6, 1.2e6), priceScore(1e6, 1.4e6)], [20, 12, 5, 0]);
});

test("size points: <300 → 10, <700 → 5, unknown size → 0", () => {
  assert.deepEqual([sqftScore(1500, 1700), sqftScore(1500, 2000), sqftScore(1500, 2500), sqftScore(null, 1500)], [10, 5, 0, 0]);
});

test("a near-identical listing scores 60 structured + 40 × similarity", () => {
  const t = { price: 900_000, beds: 3, city: "Irvine", sqft: 1260 };
  const s = similarityScore(t, { price: 920_000, beds: 3, city: "irvine", sqft: 1300 }, 0.9);
  assert.deepEqual(s, { price: 20, beds: 15, city: 15, sqft: 10, semantic: 36, total: 96 });
});

test("no embedding → semantic contributes 0; different city/beds earn nothing", () => {
  const s = similarityScore({ price: 900_000, beds: 3, city: "Irvine", sqft: 1260 }, { price: 1_150_000, beds: 4, city: "Tustin", sqft: 2100 }, null);
  assert.deepEqual(s, { price: 5, beds: 0, city: 0, sqft: 0, semantic: 0, total: 5 });
});

// --- Recognizing recommendation requests ------------------------------------
const routing: [string, boolean][] = [
  ["more like #2", true],
  ["show me homes similar to the second one", true],
  ["anything comparable to 59 Fox Hollow?", true],
  ["similar listings to that one", true],
  ["something similar to a mid-century ranch", false], // a description → semantic search
  ["similar to a 3 bedroom ranch with a pool", false],
  ["Find homes in Irvine", false],
];
for (const [q, expected] of routing) {
  test(`isRecommendationQuery=${expected}: ${q}`, () => assert.equal(isRecommendationQuery(q), expected));
}

test("a description with 'similar to' still goes to semantic search", () => {
  assert.equal(isSemanticQuery("something similar to a mid-century ranch"), true);
});

// --- Which listing does the user mean? ----------------------------------------
const shown = [
  { L_ListingID: "A", L_Address: "44 Fallbrook" },
  { L_ListingID: "B", L_Address: "59 Fox Hollow" },
  { L_ListingID: "C", L_Address: "2 Snapdragon" },
];

test("positions: #2, number 3, the first one, the last one", () => {
  assert.equal(referencedPosition("more like #2", 3), 2);
  assert.equal(referencedPosition("similar to number 3", 3), 3);
  assert.equal(referencedPosition("like the first one", 3), 1);
  assert.equal(referencedPosition("the last one", 3), 3);
});

test("resolves by position, address, hint, and 'this one' when only one was shown", () => {
  assert.equal(resolveListingReference("more like #2", shown), "B");
  assert.equal(resolveListingReference("similar to 2 Snapdragon please", shown), "C");
  assert.equal(resolveListingReference("more like that", shown, { resultNumber: 1 }), "A");
  assert.equal(resolveListingReference("similar to this one", [shown[0]!]), "A");
  assert.equal(resolveListingReference("similar to this one", shown), null, "ambiguous with several shown");
  assert.equal(resolveListingReference("more like #2", []), null);
});

test("comp verdicts", () => {
  assert.match(compVerdict({ compCount: 12, avgPpsf: 800, compPrice: 1_000_000, deltaPct: -8 }), /8% below comps/);
  assert.match(compVerdict({ compCount: 12, avgPpsf: 800, compPrice: 1_000_000, deltaPct: 6.5 }), /6.5% above comps/);
  assert.match(compVerdict({ compCount: 12, avgPpsf: 800, compPrice: 1_000_000, deltaPct: 2 }), /in line with comps/);
  assert.match(compVerdict({ compCount: 2, avgPpsf: 800, compPrice: 1_000_000, deltaPct: 2 }), /too few comparable sales/);
});
