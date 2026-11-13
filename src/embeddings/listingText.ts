import { createHash } from "node:crypto";
import { config } from "../config.ts";

/**
 * Week 6 — the text that represents a listing in embedding space.
 * Combines the handbook's key structured fields with the descriptive ones
 * (style, view, amenities) and the listing remarks.
 */

export interface ListingTextRow {
  L_ListingID: string;
  L_Type_: string | null;
  L_City: string | null;
  L_Keyword2: number | null; // beds
  LM_Dec_3: number | string | null; // baths
  LM_Int2_3: number | null; // sqft
  YearBuilt: number | null;
  L_SystemPrice: number | null;
  ArchitecturalStyle: string | null;
  View: string | null;
  PoolPrivateYN: string | null;
  AssociationAmenities: string | null;
  SubdivisionName: string | null;
  L_Remarks: string | null;
}

export const DEFAULT_MAX_REMARK_CHARS = config.embeddings.maxRemarkChars;

/** "SingleFamilyResidence" → "Single Family Residence", "Pool,Tennis" → "Pool, Tennis" */
function humanize(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

function clean(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "));
  return (lastStop > max * 0.6 ? cut.slice(0, lastStop + 1) : cut).trim();
}

export function listingTitle(r: ListingTextRow): string {
  return [humanize(r.L_Type_) || "Home", r.L_City ? `in ${r.L_City}, CA` : ""].filter(Boolean).join(" ");
}

export function buildListingText(r: ListingTextRow, maxRemarkChars = DEFAULT_MAX_REMARK_CHARS): string {
  const facts: string[] = [];
  facts.push(`${listingTitle(r)}.`);
  const specs = [
    r.L_Keyword2 ? `${r.L_Keyword2} beds` : "",
    r.LM_Dec_3 ? `${Number(r.LM_Dec_3)} baths` : "",
    r.LM_Int2_3 ? `${r.LM_Int2_3} sq ft` : "",
    r.YearBuilt ? `built ${r.YearBuilt}` : "",
  ].filter(Boolean);
  if (specs.length) facts.push(`${specs.join(", ")}.`);
  if (r.L_SystemPrice) facts.push(`Price $${Number(r.L_SystemPrice).toLocaleString("en-US")}.`);
  if (r.ArchitecturalStyle) facts.push(`Style: ${humanize(r.ArchitecturalStyle)}.`);
  if (r.View && !/^none$/i.test(r.View)) facts.push(`View: ${humanize(r.View)}.`);
  if (r.PoolPrivateYN === "True") facts.push("Private pool.");
  if (r.AssociationAmenities) facts.push(`Community amenities: ${humanize(r.AssociationAmenities)}.`);
  if (r.SubdivisionName) facts.push(`Community: ${clean(r.SubdivisionName)}.`);
  const remarks = truncate(clean(r.L_Remarks), maxRemarkChars);
  return remarks ? `${facts.join(" ")}\n${remarks}` : facts.join(" ");
}

/** Hash of the embedded text: lets the indexer skip listings whose text hasn't changed. */
export function textHash(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}
