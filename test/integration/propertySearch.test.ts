/** Weeks 2–4 against the live database.  npm run test:db */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { closeConnection } from "../../src/db/connection.ts";
import { propertySearchAgent } from "../../src/agents/propertySearch/agent.ts";
import { searchActiveListings } from "../../src/agents/propertySearch/queries.ts";

after(() => closeConnection());

test("multi-turn: asks for budget, then bedrooms, then returns listings", async () => {
  const user = `it_search_${Date.now()}`;
  const r1 = await propertySearchAgent("Find homes in Irvine", user);
  assert.equal(r1.status, "needs_input");
  assert.match(r1.response, /maximum budget/);

  const r2 = await propertySearchAgent("my maximum budget is 3m", user);
  assert.equal(r2.status, "needs_input");
  assert.match(r2.response, /bedrooms/);

  const r3 = await propertySearchAgent("at least 3 beds", user);
  assert.ok(r3.status === "success" || r3.status === "empty", r3.response);
  if (r3.status === "success") {
    const listings = r3.data!.listings!;
    assert.ok(listings.length >= 1 && listings.length <= 5);
    for (const l of listings) {
      assert.equal(l.L_City, "Irvine");
      assert.ok(Number(l.price) <= 3_000_000 && Number(l.beds) >= 3);
    }
    console.log(r3.response.split("\n").slice(0, 4).join("\n"));
  }
});

test("searchActiveListings respects filters and the 50-row cap", async () => {
  const rows = await searchActiveListings({ city: "Los Angeles", maxPrice: 900_000, beds: 2 }, 1, 500);
  assert.ok(rows.length <= 50);
  for (const r of rows) assert.ok(r.L_City === "Los Angeles" && Number(r.price) <= 900_000 && Number(r.beds) >= 2);
  assert.ok(rows.every((r, i) => i === 0 || Number(rows[i - 1]!.price) <= Number(r.price)), "sorted by price");
});

test("several property types: every listing is a condo or townhome, and cards show the type", async () => {
  const r = await propertySearchAgent("3 bedroom condos and townhomes in Irvine under $2M", `it_types_${Date.now()}`);
  assert.ok(r.status === "success" || r.status === "empty", r.response);
  if (r.status === "success") {
    for (const l of r.data!.listings!) assert.ok(["Condominium", "Townhouse"].includes(l.type), l.type);
    assert.match(r.response, /\| (Condo|Townhome)\n/);
  }
});

test("impossible budget → empty, not an error", async () => {
  const r = await propertySearchAgent("Find homes in Pasadena under 100k with 5 beds", `it_empty_${Date.now()}`);
  assert.equal(r.status, "empty");
});
