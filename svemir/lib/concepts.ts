import type { SupabaseClient } from "@supabase/supabase-js";
import { slugify } from "./constants";
import { extractTerms, type RawTermDoc } from "./extract-terms";

/**
 * Insert-then-lookup for a concept, keyed on its canonical `match_key`.
 * Race-safe the same way `ensureChannelId` is: if a concurrent writer created
 * the same concept (unique violation on match_key) we re-select it. Slug
 * collisions between *different* concepts (e.g. "C" and "C++" both slugify to
 * "c") are resolved by appending a numeric suffix.
 *
 * Returns the concept id, or null if it couldn't be created or found.
 */
export async function ensureConcept(
  client: SupabaseClient,
  matchKey: string,
  term: string,
  ngram: number
): Promise<string | null> {
  const key = matchKey.trim();
  if (!key) return null;

  // Fast path — already exists.
  const { data: existing } = await client
    .from("concepts")
    .select("id")
    .eq("match_key", key)
    .maybeSingle();
  if (existing) return existing.id as string;

  const base = slugify(term) || slugify(key) || "concept";

  for (let attempt = 0; attempt < 6; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const { data: inserted, error } = await client
      .from("concepts")
      .insert({ match_key: key, term, slug, ngram })
      .select("id")
      .single();
    if (!error && inserted) return inserted.id as string;

    // A unique violation means either the match_key already exists (someone
    // beat us to it) or this slug is taken by another concept. Disambiguate by
    // re-selecting on match_key: found → return it; not found → slug clash, so
    // loop and try the next slug.
    const { data: race } = await client
      .from("concepts")
      .select("id")
      .eq("match_key", key)
      .maybeSingle();
    if (race) return race.id as string;
  }
  return null;
}

/**
 * Refresh the denormalized `block_count` (prevalence) for specific concepts.
 * Done with per-row updates (each carries a `WHERE id = …`) so it works under
 * Supabase's "safe update" mode, which rejects an UPDATE without a WHERE clause
 * — the reason an earlier set-based recompute RPC silently failed.
 */
async function refreshConceptCounts(
  client: SupabaseClient,
  conceptIds: Iterable<string>
): Promise<void> {
  for (const id of new Set(conceptIds)) {
    const { count } = await client
      .from("block_concepts")
      .select("*", { count: "exact", head: true })
      .eq("concept_id", id);
    await client
      .from("concepts")
      .update({ block_count: count ?? 0 })
      .eq("id", id);
  }
}

/**
 * Extract concepts from a block's text and (re)write its `block_concepts` rows.
 * Idempotent: clears the block's existing concept links first, so re-running on
 * an edited block produces a clean set. Marks `items.concepts_indexed_at`, and
 * refreshes prevalence counts for every concept touched (added or removed) so
 * `/concepts` and the graph stay accurate after each add or backfill batch.
 *
 * Returns the number of concept links written. Must be called with the
 * service-role client (writes are RLS-protected).
 */
export async function reconcileBlockConcepts(
  client: SupabaseClient,
  blockId: string,
  doc: RawTermDoc
): Promise<number> {
  const terms = extractTerms(doc);

  const rows: {
    block_id: string;
    concept_id: string;
    count: number;
    tf: number;
  }[] = [];

  for (const t of terms) {
    const id = await ensureConcept(client, t.matchKey, t.term, t.ngram);
    if (!id) continue;
    rows.push({ block_id: blockId, concept_id: id, count: t.count, tf: t.tf });
  }

  // Capture the prior links so a concept this block *dropped* (on re-index of an
  // edited block) also gets its prevalence recounted.
  const { data: prev } = await client
    .from("block_concepts")
    .select("concept_id")
    .eq("block_id", blockId);
  const prevIds = (prev ?? []).map((r) => r.concept_id as string);

  await client.from("block_concepts").delete().eq("block_id", blockId);
  if (rows.length > 0) {
    await client
      .from("block_concepts")
      .upsert(rows, { onConflict: "block_id,concept_id" });
  }

  await client
    .from("items")
    .update({ concepts_indexed_at: new Date().toISOString() })
    .eq("id", blockId);

  await refreshConceptCounts(client, [...rows.map((r) => r.concept_id), ...prevIds]);

  return rows.length;
}
