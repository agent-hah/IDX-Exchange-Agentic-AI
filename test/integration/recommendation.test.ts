/** Week 7 against the live database (embeddings optional).  npm run test:db */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { closeConnection } from "../../src/db/connection.ts";
import { propertySearchAgent } from "../../src/agents/propertySearch/agent.ts";
import { recommendationAgent } from "../../src/agents/recommendation/agent.ts";
import { validateWithComps } from "../../src/agents/recommendation/queries.ts";
import { route } from "../../src/index.ts";

after(() => closeConnection());

test("search, then 'more like #2': 5 scored, comp-checked recommendations", async () => {
  const user = `it_rec_${Date.now()}`;
  const search = await propertySearchAgent("3 bedroom homes in Irvine under $2M", user);
  assert.equal(search.status, "success", search.response);
  const second = search.data!.listings![1]!;

  const r = await recommendationAgent("more like #2", user);
  assert.equal(r.status, "success", r.response);
  const { target, recommendations } = r.data!;
  assert.equal(target.L_ListingID, second.L_ListingID, "picked the 2nd listing shown");
  assert.equal(recommendations.length, 5);
  assert.ok(recommendations.every((x) => x.listing.L_ListingID !== target.L_ListingID), "never recommends the listing itself");
  assert.ok(recommendations.every((x, i) => i === 0 || recommendations[i - 1]!.score.total >= x.score.total), "sorted by score");
  assert.ok(recommendations.every((x) => x.score.total >= 0 && x.score.total <= 100));
  assert.ok(recommendations.every((x) => Math.abs(Number(x.listing.price) - Number(target.price)) <= 300_000), "within $300K");
  console.log(r.response);
});

test("comp check is internally consistent", async () => {
  const c = await validateWithComps("Irvine", 1500, 1_200_000);
  if (c.compCount > 0 && c.compPrice !== null && c.avgPpsf !== null) {
    assert.ok(Math.abs(c.compPrice - c.avgPpsf * 1500) <= 1500, "compPrice ≈ avgPpsf × sqft");
    assert.ok(Math.abs(c.deltaPct! - ((1_200_000 - c.compPrice) / c.compPrice) * 100) < 0.1);
  }
});

test("no listing to compare → asks which one", async () => {
  const r = await recommendationAgent("more like #2", `it_rec_empty_${Date.now()}`);
  assert.equal(r.status, "needs_input");
});

test("router sends 'more like #2' to the recommendation agent", async () => {
  assert.equal((await route("more like #2", `it_rec_r_${Date.now()}`)).intent, "recommendation");
});
