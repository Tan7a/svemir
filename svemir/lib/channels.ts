import type { SupabaseClient } from "@supabase/supabase-js";
import { slugify } from "./constants";

export type RecentChannel = {
  id: string;
  slug: string;
  title: string;
  block_count: number;
  last_connected_at: string | null;
};

export type ChannelStat = {
  id: string;
  title: string;
  block_count: number;
  source_names: string[];
};

/**
 * Insert-then-lookup pattern for channels. Race-safe at personal scale: if
 * the insert fails on the lower(title) unique index, we ilike-match the
 * existing row. Returns null only if title is empty or both the insert and
 * the fallback select fail.
 *
 * Resolves by **title**, not slug - callers (admin form and bearer-token
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

/**
 * Comparator: most-recently-connected first, channels with no connections
 * (null) last, alphabetical by title as the tie-break. Shared by the home
 * Channels view and `recentChannels` so both order identically.
 */
export function compareChannelRecency(
  a: { last_connected_at: string | null; title: string },
  b: { last_connected_at: string | null; title: string }
): number {
  if (a.last_connected_at && b.last_connected_at) {
    return b.last_connected_at.localeCompare(a.last_connected_at);
  }
  if (a.last_connected_at) return -1;
  if (b.last_connected_at) return 1;
  return a.title.localeCompare(b.title);
}

/**
 * Channels ordered by most-recently-connected. Channels with no connections
 * fall to the bottom (last_connected_at IS NULL). Aggregated in SQL via the
 * recent_channels RPC (migration 0011) - the previous JS aggregation pulled
 * every connections row of every channel and grew with the archive.
 */
export async function recentChannels(
  client: SupabaseClient,
  limit = 20
): Promise<RecentChannel[]> {
  const { data, error } = await client.rpc("recent_channels", { lim: limit });
  if (error || !data) return [];
  return data as RecentChannel[];
}

/**
 * Per-channel stats used by the heuristic suggester:
 * - block_count: how many blocks are connected
 * - source_names: distinct source_name values from those blocks (used to
 *   bias suggestion toward channels that already collect the same source)
 *
 * Aggregated in SQL via the channel_stats RPC (migration 0011) - the
 * previous JS aggregation pulled the source_name of every connected item
 * across all channels and grew with the archive.
 */
export async function channelStats(
  client: SupabaseClient
): Promise<ChannelStat[]> {
  const { data, error } = await client.rpc("channel_stats");
  if (error || !data) return [];
  return data as ChannelStat[];
}
