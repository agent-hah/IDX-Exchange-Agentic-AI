import { test } from "node:test";
import assert from "node:assert/strict";
import { activeListingWhere, hasAnyFilter } from "../../src/db/listingFilters.ts";
import { fmtDate, fmtInt, fmtMoney, fmtMonth, fmtPct, fmtPrice } from "../../src/utils/format.ts";

test("activeListingWhere: no filters → active only", () => {
  assert.deepEqual(activeListingWhere({}), { where: "L_Status = 'Active'", params: [] });
  assert.equal(hasAnyFilter({ city: null, maxPrice: null }), false);
});

test("activeListingWhere: every filter, in a stable order", () => {
  const { where, params } = activeListingWhere({
    city: "Irvine", maxPrice: 1_500_000, beds: 3, baths: 2, sqft: 1500,
    type: "Condominium", pool: "True", hasView: "True",
  });
  assert.equal(
    where,
    "L_Status = 'Active' AND L_City = ? AND L_SystemPrice <= ? AND L_Keyword2 >= ? AND LM_Dec_3 >= ? AND LM_Int2_3 >= ? AND L_Type_ = ? AND PoolPrivateYN = ? AND ViewYN = ?",
  );
  assert.deepEqual(params, ["Irvine", 1_500_000, 3, 2, 1500, "Condominium", "True", "True"]);
});

test("activeListingWhere: nulls, empty strings and zero are ignored", () => {
  assert.deepEqual(activeListingWhere({ city: "", beds: 0, maxPrice: null }).params, []);
});

test("formatting helpers", () => {
  assert.equal(fmtPrice(1250000), "$1,250,000");
  assert.equal(fmtMoney(1_450_000), "$1.45M");
  assert.equal(fmtMoney(845_000), "$845K");
  assert.equal(fmtMoney(812), "$812");
  assert.equal(fmtMoney(null), "n/a");
  assert.equal(fmtPct(4.2), "+4.2%");
  assert.equal(fmtPct(98, false), "98.0%");
  assert.equal(fmtInt(4620), "4,620");
  assert.equal(fmtMonth("2026-09"), "Sep 26");
  assert.equal(fmtDate("2026-09-17"), "Sep 17, 2026");
});
