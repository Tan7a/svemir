import type { SupabaseClient } from "@supabase/supabase-js";
import { slugify } from "./constants";

/**
 * The five facet dimensions along which papers connect (see 0007_papers.sql).
 * Kept in sync with the CHECK constraint on paper_facets.dimension.
 */
export type Dimension =
  | "ai_technique"
  | "ux_effect"
  | "challenge"
  | "metric"
  | "ethical_concern";

/**
 * The shape Claude Code produces per paper (paper-facets.json) and the input to
 * reconcilePaperFacets. Each field is a list of short, canonical facet values;
 * recurring values are what link papers together in the facet network.
 */
export type PaperFacetInput = {
  aiTechniques?: string[];
  uxEffects?: string[];
  challenges?: string[];
  metrics?: string[];
  ethicalConcerns?: string[];
};

/** Maps the JSON-friendly facet keys to their DB dimension value. */
const DIMENSION_BY_KEY: Record<keyof PaperFacetInput, Dimension> = {
  aiTechniques: "ai_technique",
  uxEffects: "ux_effect",
  challenges: "challenge",
  metrics: "metric",
  ethicalConcerns: "ethical_concern",
};

/** Escape LIKE/ILIKE metacharacters so a value is matched literally. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Insert-then-lookup for a facet, keyed on (dimension, lower(value)) - the
 * unique index from 0007. Race-safe the same way `ensureConcept` is: if a
 * concurrent writer created the same facet (unique violation) we re-select it.
 * Slug collisions between *different* facet values that slugify identically are
 * resolved by appending a numeric suffix.
 *
 * Returns the facet id, or null if it couldn't be created or found. Must be
 * called with the service-role client (writes are RLS-protected).
 */
export async function ensureFacet(
  client: SupabaseClient,
  dimension: Dimension,
  rawValue: string
): Promise<string | null> {
  const value = rawValue.trim();
  if (!value) return null;

  // Fast path - already exists (case-insensitive match within the dimension).
  const { data: existing } = await client
    .from("paper_facets")
    .select("id")
    .eq("dimension", dimension)
    .ilike("value", escapeLike(value))
    .maybeSingle();
  if (existing) return existing.id as string;

  // Dimension-prefixed slug keeps the same value distinct across dimensions
  // (e.g. ai_technique-personalization vs ux_effect-personalization).
  const base = slugify(`${dimension} ${value}`) || slugify(dimension) || "facet";

  for (let attempt = 0; attempt < 6; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const { data: inserted, error } = await client
      .from("paper_facets")
      .insert({ dimension, value, slug })
      .select("id")
      .single();
    if (!error && inserted) return inserted.id as string;

    // A unique violation means either the (dimension, value) already exists
    // (someone beat us to it) or this slug is taken by a *different* facet.
    // Disambiguate by re-selecting on (dimension, value): found → return it;
    // not found → slug clash, so loop and try the next slug.
    const { data: race } = await client
      .from("paper_facets")
      .select("id")
      .eq("dimension", dimension)
      .ilike("value", escapeLike(value))
      .maybeSingle();
    if (race) return race.id as string;
  }
  return null;
}

/**
 * Refresh the denormalized `paper_count` (prevalence) for specific facets.
 * Per-row updates (each carries a WHERE id = …) so it works under Supabase's
 * "safe update" mode, exactly like refreshConceptCounts in lib/concepts.ts.
 */
async function refreshFacetCounts(
  client: SupabaseClient,
  facetIds: Iterable<string>
): Promise<void> {
  for (const id of new Set(facetIds)) {
    const { count } = await client
      .from("paper_facet_links")
      .select("*", { count: "exact", head: true })
      .eq("facet_id", id);
    await client
      .from("paper_facets")
      .update({ paper_count: count ?? 0 })
      .eq("id", id);
  }
}

/**
 * (Re)write a paper's facet links across all five dimensions. Idempotent:
 * clears the paper's existing links first, so re-running with revised facets
 * produces a clean set. Refreshes prevalence for every facet touched (added or
 * removed) so the counts and the facet network stay accurate.
 *
 * Returns the number of facet links written. Must be called with the
 * service-role client (writes are RLS-protected).
 */
export async function reconcilePaperFacets(
  client: SupabaseClient,
  paperId: string,
  facets: PaperFacetInput
): Promise<number> {
  // Flatten the input into (dimension, value) pairs, de-duped within the paper.
  const seen = new Set<string>();
  const facetIds: string[] = [];
  for (const [key, dimension] of Object.entries(DIMENSION_BY_KEY) as [
    keyof PaperFacetInput,
    Dimension
  ][]) {
    for (const raw of facets[key] ?? []) {
      const value = raw.trim();
      if (!value) continue;
      const dedupKey = `${dimension}::${value.toLowerCase()}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      const id = await ensureFacet(client, dimension, value);
      if (id) facetIds.push(id);
    }
  }

  // Capture prior links so a facet this paper *dropped* also gets recounted.
  const { data: prev } = await client
    .from("paper_facet_links")
    .select("facet_id")
    .eq("paper_id", paperId);
  const prevIds = (prev ?? []).map((r) => r.facet_id as string);

  await client.from("paper_facet_links").delete().eq("paper_id", paperId);
  if (facetIds.length > 0) {
    const rows = facetIds.map((facet_id) => ({ paper_id: paperId, facet_id }));
    await client
      .from("paper_facet_links")
      .upsert(rows, { onConflict: "paper_id,facet_id" });
  }

  await refreshFacetCounts(client, [...facetIds, ...prevIds]);

  return facetIds.length;
}
