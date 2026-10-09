import { propertySearch, PropertyFilters } from "../skills/propertySearch.ts";
import assert from "assert";

interface TestCase {
  query: string;
  expected: PropertyFilters;
}

async function runTests() {
  const tests: TestCase[] = [
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

  console.log("--- Running Week 2 NLP Parser Tests ---\n");
  let passedCount = 0;

  for (let i = 0; i < tests.length; i++) {
    const { query, expected } = tests[i];
    const actual = await propertySearch(query);

    try {
      // assert.deepStrictEqual checks that all keys and values match exactly
      assert.deepStrictEqual(actual, expected);
      console.log(`Test ${i + 1} Passed: "${query}"`);
      passedCount++;
    } catch (error) {
      console.error(`Test ${i + 1} Failed: "${query}"`);
      console.error("   Expected:", expected);
      console.error("   Actual:  ", actual);
      console.error("--------------------------------------------------");
    }
  }

  console.log(`\nResults: ${passedCount} out of ${tests.length} tests passed.`);
}

runTests();
