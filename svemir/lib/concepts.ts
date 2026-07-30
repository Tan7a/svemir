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

  // Fast path - already exists.
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
 * - the reason an earlier set-based recompute RPC silently failed.
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
    if ((count ?? 0) === 0) {
      // A zero-count concept is dead weight at best and a privacy leak at
      // worst: `concepts` is select-using(true), so a term whose only source
      // was a private block would stay enumerable via PostgREST (and its
      // /concept/<slug> page would still render). Deleting it closes that.
      // If the term recurs later, ensureConcept simply recreates it.
      await client.from("concepts").delete().eq("id", id);
    } else {
      await client.from("concepts").update({ block_count: count }).eq("id", id);
    }
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
  // 20 (up from the extractor's default 12) so longer blocks and papers
  // contribute a fuller spread of terms; run "Re-extract all" after changing.
  const terms = extractTerms(doc, { maxTerms: 20 });

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

/**
 * Remove a block's concept rows entirely and refresh the counts they backed.
 * Used for blocks that live only in private channels: concepts/block_concepts
 * are select-using(true), so leaving rows behind would leak a private block's
 * vocabulary into the public cloud. Stamps `concepts_indexed_at` (the block HAS
 * been processed; the correct result is "no public concepts") so backfill
 * passes don't reprocess it forever. If the block later becomes public again,
 * syncBlockConceptPrivacy re-extracts based on it having no concept rows.
 */
export async function removeBlockConcepts(
  client: SupabaseClient,
  blockId: string
): Promise<void> {
  const { data: prev } = await client
    .from("block_concepts")
    .select("concept_id")
    .eq("block_id", blockId);
  const prevIds = (prev ?? []).map((r) => r.concept_id as string);

  if (prevIds.length > 0) {
    await client.from("block_concepts").delete().eq("block_id", blockId);
  }
  await client
    .from("items")
    .update({ concepts_indexed_at: new Date().toISOString() })
    .eq("id", blockId);
  if (prevIds.length > 0) {
    await refreshConceptCounts(client, prevIds);
  }
}

/**
 * True when the block has at least one connection and every one of them points
 * at a private channel - the "hidden from the public site" state the RLS
 * policies in migration 0012 enforce. Service-role client required (it must
 * see private channels to answer the question).
 */
export async function isPrivateOnly(
  client: SupabaseClient,
  blockId: string
): Promise<boolean> {
  const { data, error } = await client
    .from("connections")
    .select("channels(is_private)")
    .eq("block_id", blockId);
  if (error) {
    // Fail CLOSED. Swallowing this and returning false would treat the block
    // as public - under a forced backfill that re-publishes concepts for a
    // genuinely private block. Callers decide how to surface the failure.
    throw new Error(`isPrivateOnly(${blockId}): ${error.message}`);
  }
  const flags = (data ?? []).flatMap((r) => {
    const raw = (r as { channels: unknown }).channels;
    return (Array.isArray(raw) ? raw : [raw]).map(
      (c) => (c as { is_private?: boolean } | null)?.is_private === true
    );
  });
  return flags.length > 0 && flags.every(Boolean);
}
