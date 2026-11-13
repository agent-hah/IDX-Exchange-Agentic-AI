/**
 * The one place that turns property filters into SQL over rets_property.
 * Used by the Week 3–4 structured search and the Week 6 semantic search
 * (and the Week 7 recommendation engine next).
 */

export interface ListingFilters {
  city?: string | null;
  maxPrice?: number | null;
  beds?: number | null; // minimum
  baths?: number | null; // minimum
  sqft?: number | null; // minimum
  type?: string | null; // L_Type_, e.g. "Condominium"
  types?: string[] | null; // several L_Type_ values (OR); takes precedence over `type`
  pool?: string | null; // "True"
  hasView?: string | null; // "True"
}

/** WHERE clause (always active listings) + positional params. */
export function activeListingWhere(f: ListingFilters): { where: string; params: (string | number)[] } {
  const clauses = ["L_Status = 'Active'"];
  const params: (string | number)[] = [];
  const add = (clause: string, value: string | number | null | undefined) => {
    if (value === null || value === undefined || value === "" || value === 0) return;
    clauses.push(clause);
    params.push(value);
  };
  add("L_City = ?", f.city);
  add("L_SystemPrice <= ?", f.maxPrice);
  add("L_Keyword2 >= ?", f.beds);
  add("LM_Dec_3 >= ?", f.baths);
  add("LM_Int2_3 >= ?", f.sqft);
  if (f.types && f.types.length > 0) {
    clauses.push(`L_Type_ IN (${f.types.map(() => "?").join(", ")})`);
    params.push(...f.types);
  } else {
    add("L_Type_ = ?", f.type);
  }
  add("PoolPrivateYN = ?", f.pool);
  add("ViewYN = ?", f.hasView);
  return { where: clauses.join(" AND "), params };
}

export function hasAnyFilter(f: ListingFilters): boolean {
  return activeListingWhere(f).params.length > 0;
}
