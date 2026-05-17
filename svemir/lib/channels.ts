import type { SupabaseClient } from "@supabase/supabase-js";
import { slugify } from "./constants";

/**
 * Insert-then-lookup pattern for channels. Race-safe at personal scale: if
 * the insert fails on the lower(title) unique index, we ilike-match the
 * existing row. Returns null only if title is empty or both the insert and
 * the fallback select fail.
 *
 * Resolves by **title**, not slug — callers (admin form and bearer-token
 * API) accept user-typed titles and let this helper handle slug generation
 * and dedup. Sending a pre-slugified value would mismatch the case-insensitive
 * title index for existing channels (e.g. "ui-design" ≠ "UI Design").
 */
export async function ensureChannelId(
  client: SupabaseClient,
  rawTitle: string
): Promise<string | null> {
  const title = rawTitle.trim();
  if (!title) return null;

  const slug = slugify(title);
  if (!slug) return null;

  const { data: inserted, error: insertErr } = await client
    .from("channels")
    .insert({ title, slug })
    .select("id")
    .single();

  if (!insertErr && inserted) return inserted.id as string;

  const { data: existing } = await client
    .from("channels")
    .select("id")
    .ilike("title", title)
    .maybeSingle();

  return (existing?.id as string | undefined) ?? null;
}
