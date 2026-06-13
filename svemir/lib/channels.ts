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

/**
 * Newest `connected_at` across a channel's connection rows, or null when the
 * channel has no connections. Used to order channels by when a block was most
 * recently saved into them.
 */
export function lastConnectedAt(
  conns: { connected_at: string | null }[] | null
): string | null {
  let last: string | null = null;
  for (const x of conns ?? []) {
    if (x.connected_at && (last === null || x.connected_at > last)) {
      last = x.connected_at;
    }
  }
  return last;
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
 * fall to the bottom (last_connected_at IS NULL). Aggregation in JS keeps
 * the Supabase query simple — fine at personal scale (<1000 channels).
 */
export async function recentChannels(
  client: SupabaseClient,
  limit = 20
): Promise<RecentChannel[]> {
  const { data, error } = await client
    .from("channels")
    .select(
      "id, slug, title, connections(connected_at)"
    );
  if (error || !data) return [];

  type Row = {
    id: string;
    slug: string;
    title: string;
    connections: { connected_at: string | null }[] | null;
  };

  const enriched: RecentChannel[] = (data as Row[]).map((c) => {
    const conns = c.connections ?? [];
    return {
      id: c.id,
      slug: c.slug,
      title: c.title,
      block_count: conns.length,
      last_connected_at: lastConnectedAt(conns),
    };
  });

  enriched.sort(compareChannelRecency);

  return enriched.slice(0, limit);
}

/**
 * Per-channel stats used by the heuristic suggester:
 * - block_count: how many blocks are connected
 * - source_names: distinct source_name values from those blocks (used to
 *   bias suggestion toward channels that already collect the same source)
 *
 * One round-trip via a join. Fine at personal scale (~50 channels, ~1k
 * blocks). If this ever becomes slow, push the aggregation to SQL via an
 * RPC.
 */
export async function channelStats(
  client: SupabaseClient
): Promise<ChannelStat[]> {
  const { data, error } = await client
    .from("channels")
    .select("id, title, connections(items(source_name))");
  if (error || !data) return [];

  type Row = {
    id: string;
    title: string;
    connections:
      | {
          items:
            | { source_name: string | null }
            | { source_name: string | null }[]
            | null;
        }[]
      | null;
  };

  return (data as unknown as Row[]).map((c) => {
    const conns = c.connections ?? [];
    const sources = new Set<string>();
    for (const x of conns) {
      const itemsField = x.items;
      const item = Array.isArray(itemsField) ? itemsField[0] : itemsField;
      const s = item?.source_name;
      if (s && s.trim()) sources.add(s.trim());
    }
    return {
      id: c.id,
      title: c.title,
      block_count: conns.length,
      source_names: [...sources],
    };
  });
}
