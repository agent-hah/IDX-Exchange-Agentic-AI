import { test } from "node:test";
import assert from "node:assert/strict";
import { extractCity, parsePropertyQuery, type PropertyFilters } from "../../src/agents/propertySearch/parser.ts";

// Week 2 deliverable: the parser validated against 10+ free-text queries.
const cases: { query: string; expected: PropertyFilters }[] = [
  {
    query: "Show me 3-bedroom condos in Irvine under $1.5M with a pool",
    expected: {
      city: "Irvine",
      maxPrice: 1500000,
      beds: 3,
      baths: null,
      sqft: null,
      type: "Condominium",
      pool: "True",
      hasView: null,
    },
  },
  {
    query: "Find single family homes in Newport Beach under 2.5m with a view",
    expected: {
      city: "Newport Beach",
      maxPrice: 2500000,
      beds: null,
      baths: null,
      sqft: null,
      type: "SingleFamilyResidence",
      pool: null,
      hasView: "True",
    },
  },
  {
    query: "Looking for a townhome in San Diego under 800k",
    expected: {
      city: "San Diego",
      maxPrice: 800000,
      beds: null,
      baths: null,
      sqft: null,
      type: "Townhouse",
      pool: null,
      hasView: null,
    },
  },
  {
    query: "I need 4 beds and 3 baths in Riverside",
    expected: {
      city: "Riverside",
      maxPrice: null,
      beds: 4,
      baths: 3,
      sqft: null,
      type: null,
      pool: null,
      hasView: null,
    },
  },
  {
    query: "Show me homes under $500,000 with a pool",
    expected: {
      city: null,
      maxPrice: 500000,
      beds: null,
      baths: null,
      sqft: null,
      type: null,
      pool: "True",
      hasView: null,
    },
  },
  {
    query: "2 bed 1.5 bath condo in Pasadena under 750k",
    expected: {
      city: "Pasadena",
      maxPrice: 750000,
      beds: 2,
      baths: 1.5,
      sqft: null,
      type: "Condominium",
      pool: null,
      hasView: null,
    },
  },
  {
    query: "Find land in Joshua Tree under 100k",
    expected: {
      city: "Joshua Tree",
      maxPrice: 100000,
      beds: null,
      baths: null,
      sqft: null,
      type: "Unimproved Land",
      pool: null,
      hasView: null,
    },
  },
  {
    query: "Show me large homes with 3000 sqft in Los Angeles",
    expected: {
      city: "Los Angeles",
      maxPrice: null,
      beds: null,
      baths: null,
      sqft: 3000,
      type: null,
      pool: null,
      hasView: null,
    },
  },
  {
    query: "I want a 5 bedroom house in Beverly Hills with a pool and view",
    expected: {
      city: "Beverly Hills",
      maxPrice: null,
      beds: 5,
      baths: null,
      sqft: null,
      type: null,
      pool: "True",
      hasView: "True",
    },
  },
  {
    query: "Just looking for a place in Sacramento",
    expected: {
      city: "Sacramento",
      maxPrice: null,
      beds: null,
      baths: null,
      sqft: null,
      type: null,
      pool: null,
      hasView: null,
    },
  },
];

for (const { query, expected } of cases) {
  test(`parses: ${query}`, () => {
    assert.deepEqual(parsePropertyQuery(query), expected);
  });
}

test("several property types: condos and townhomes", () => {
  const f = parsePropertyQuery("3 bedroom condos and townhomes in Irvine under $1.2M");
  assert.equal(f.type, "Condominium");
  assert.deepEqual(f.types, ["Condominium", "Townhouse"]);
  assert.equal(f.beds, 3);
  assert.equal(f.maxPrice, 1_200_000);
});

test("type words match whole words only (Oakland is not land)", () => {
  assert.equal(parsePropertyQuery("Find homes in Oakland").type, null);
  assert.equal(parsePropertyQuery("Show me townhouses in Irvine").type, "Townhouse");
  assert.equal(parsePropertyQuery("a condominium in San Diego").type, "Condominium");
  assert.equal(parsePropertyQuery("single-family homes in Fresno").type, "SingleFamilyResidence");
  assert.equal(parsePropertyQuery("Find land in Joshua Tree").type, "Unimproved Land");
});

test("extractCity returns null without 'in <city>'", () => {
  assert.equal(extractCity("Show me homes under $500,000 with a pool"), null);
  assert.equal(extractCity("condos in Newport Beach under 2m"), "Newport Beach");
});
