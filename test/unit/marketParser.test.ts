import { test } from "node:test";
import assert from "node:assert/strict";
import { isMarketQuestion, parseMarketQuery } from "../../src/agents/marketStats/parser.ts";
import type { MarketFilters } from "../../src/agents/marketStats/queries.ts";

const f = (p: Partial<MarketFilters>): MarketFilters => ({
  city: null, zip: null, subType: null, months: 12, ...p,
});

const parseCases: [string, MarketFilters][] = [
  ["Is now a good time to buy in San Diego?", f({ city: "San Diego" })],
  ["What is the average price per sq ft in Pasadena?", f({ city: "Pasadena" })],
  ["Median price for condos in Irvine over the last 6 months", f({ city: "Irvine", subType: "Condominium", months: 6 })],
  ["How has 92618 done over the past 2 years?", f({ zip: "92618", months: 24 })],
  ["Days on market in newport beach", f({ city: "Newport Beach" })],
  ["How is the Riverside market doing?", f({ city: "Riverside" })],
  ["Are single family home prices rising in Los Angeles?", f({ city: "Los Angeles", subType: "SingleFamilyResidence" })],
  ["List-to-close ratio for townhomes in San Jose, last 3 months", f({ city: "San Jose", subType: "Townhouse", months: 3 })],
  ["Show me market trends for the last 12 months", f({})],
  ["What's the median sold price in Santa Clarita compared to last year?", f({ city: "Santa Clarita" })],
  ["Pasadena home prices year over year", f({ city: "Pasadena" })],
  ["Market stats in Irvine CA", f({ city: "Irvine" })],
];

const intentCases: [string, boolean][] = [
  ["Is now a good time to buy in San Diego?", true],
  ["What is the average price per sq ft in Pasadena?", true],
  ["Are prices rising in Irvine?", true],
  ["What's the DOM in Fresno?", true],
  ["Show me 3-bedroom condos in Irvine under $1.5M", false],
  ["my maximum budget is 900k", false],
  ["Single family with at least 3 beds", false],
];

for (const [q, expected] of parseCases) {
  test(`parses: ${q}`, () => assert.deepEqual(parseMarketQuery(q), expected));
}
for (const [q, expected] of intentCases) {
  test(`isMarketQuestion=${expected}: ${q}`, () => assert.equal(isMarketQuestion(q), expected));
}
