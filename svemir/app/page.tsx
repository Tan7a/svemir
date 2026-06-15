import Link from "next/link";
import { supabase } from "@/lib/supabase-client";
import TopBar from "@/components/TopBar";
import { type ViewKind, type OrderKind } from "@/components/FilterBar";
import BlocksView from "@/components/BlocksView";
import BlocksVibeView from "@/components/BlocksVibeView";
import ChannelsView from "@/components/ChannelsView";
import { lastConnectedAt, compareChannelRecency } from "@/lib/channels";
import type { Channel, ChannelWithBlocks, Item } from "@/lib/types";

export const revalidate = 60;

const ALLOWED_VIEWS: Record<string, ViewKind> = {
  channels: "channels",
  blocks: "blocks",
};

const ALLOWED_ORDERS: Record<string, OrderKind> = {
  relevance: "relevance",
  updated: "updated",
  newest: "newest",
  oldest: "oldest",
  alphabetical: "alphabetical",
  source: "source",
  type: "type",
  theme: "theme",
  vibes: "vibes",
  connections: "connections",
  random: "random",
};

type SP = Promise<{
  view?: string;
  order?: string;
  q?: string;
}>;

export default async function Home({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const view: ViewKind =
    (sp.view && ALLOWED_VIEWS[sp.view]) || "channels";
  // Channels default to "updated" (most-recently-saved block first); blocks
  // default to "newest". Both still honour an explicit ?order= in the URL.
  const order: OrderKind =
    (sp.order && ALLOWED_ORDERS[sp.order]) ||
    (view === "channels" ? "updated" : "newest");
  const q = (sp.q ?? "").trim();

  if (!supabase) {
    return (
      <>
        <TopBar />
        <main className="p-8 text-sm text-neutral-400">
          Supabase is not configured. Add{" "}
          <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to <code>.env.local</code>.
        </main>
      </>
    );
  }

  // Counts for the Info column — cheap with head + exact count.
  const [{ count: blockCount }, { count: channelCount }] = await Promise.all([
    supabase.from("items").select("id", { count: "exact", head: true }),
    supabase.from("channels").select("id", { count: "exact", head: true }),
  ]);

  return (
    <>
      <TopBar />
      <div className="border-b border-neutral-900">
        <div className="flex items-baseline justify-between gap-4 px-5 pt-8 pb-4">
          <Link href="/" aria-label="svemir home">
            <h1 className="font-[family-name:var(--font-display)] text-6xl tracking-wider text-neutral-100">
              svemir
            </h1>
          </Link>
          <p className="shrink-0 text-xs text-neutral-500">
            {blockCount ?? 0} blocks · {channelCount ?? 0} channels ·{" "}
            {blockCount ?? 0} nodes
          </p>
        </div>
      </div>

      <main>
        {q ? (
          <SearchRoute q={q} />
        ) : view === "blocks" ? (
          <BlocksRoute order={order} />
        ) : (
          <ChannelsRoute order={order} />
        )}
      </main>
    </>
  );
}

/** Server component fetching items for the Blocks view. */
async function BlocksRoute({ order }: { order: OrderKind }) {
  if (!supabase) return null;

  // Map order kinds to Supabase order spec. Order kinds we don't yet support
  // fall back to newest-first so the URL is always honoured visually.
  let query = supabase.from("items").select("*").limit(500);
  switch (order) {
    case "oldest":
      query = query.order("created_at", { ascending: true });
      break;
    case "alphabetical":
      query = query.order("title", { ascending: true });
      break;
    case "source":
      // Cluster blocks from the same source together; unsourced last.
      query = query.order("source_name", { ascending: true, nullsFirst: false });
      break;
    case "newest":
    case "updated":
    case "relevance":
    case "connections":
    case "random":
    default:
      query = query.order("created_at", { ascending: false });
      break;
  }

  const { data, error } = await query;
  if (error) {
    return (
      <div className="p-8 text-sm text-red-400">
        Failed to load blocks: {error.message}
      </div>
    );
  }
  const blocks = (data ?? []) as Item[];
  // Vibes is now an interactive scale rather than a one-shot shuffle.
  if (order === "vibes") return <BlocksVibeView blocks={blocks} />;
  if (order === "random") shuffle(blocks);
  else if (order === "type") orderByType(blocks);
  else if (order === "theme") orderByTheme(blocks);
  return <BlocksView blocks={blocks} />;
}

/**
 * Server component fetching channels + their connected blocks.
 *
 * Previously this fanned out N×2 queries (8 blocks + exact count) per
 * channel — at ~50 channels that's 100 Supabase round-trips through a
 * single HTTPS pool. Collapsing into one nested select trades bandwidth
 * (we transfer every connection row instead of 8) for latency. At
 * personal scale (~1k blocks across ~50 channels) the payload is small.
 */
async function ChannelsRoute({ order }: { order: OrderKind }) {
  if (!supabase) return null;
  const client = supabase;

  const { data: chData, error: chErr } = await client
    .from("channels")
    .select("*, connections(position, connected_at, items(*))")
    .limit(500);

  if (chErr) {
    return (
      <div className="p-8 text-sm text-red-400">
        Failed to load channels: {chErr.message}
      </div>
    );
  }

  type ChannelWithConns = Channel & {
    connections:
      | { position: number; connected_at: string | null; items: unknown }[]
      | null;
  };
  // Carry last_connected_at alongside the card data so we can order by it.
  type EnrichedChannel = ChannelWithBlocks & { last_connected_at: string | null };

  const enriched: EnrichedChannel[] = ((chData ?? []) as ChannelWithConns[]).map(
    (c) => {
      const { connections, ...rest } = c;
      const conns = connections ?? [];
      const all = conns
        .map((row) => {
          const it = row.items;
          const item = Array.isArray(it) ? it[0] : it;
          return { position: row.position, item: item as Item | undefined };
        })
        .filter((row): row is { position: number; item: Item } => !!row.item)
        .sort((a, b) => a.position - b.position);
      return {
        ...rest,
        blocks: all.slice(0, 8).map((r) => r.item),
        block_count: all.length,
        last_connected_at: lastConnectedAt(conns),
      };
    }
  );

  sortChannels(enriched, order);

  return <ChannelsView channels={enriched} />;
}

/** In-place Fisher-Yates shuffle for the "Random" order. */
function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// "By type" — group by kind (links, then images, then text). Array.sort is
// stable, so within each group the created_at-desc order is preserved.
const KIND_RANK: Record<string, number> = { link: 0, image: 1, text: 2 };
function orderByType(blocks: Item[]): void {
  blocks.sort((a, b) => (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9));
}

// "By theme" — cluster blocks sharing a first category; uncategorised last.
function orderByTheme(blocks: Item[]): void {
  const themeOf = (b: Item) =>
    b.categories?.[0] ? b.categories[0].toLowerCase() : "￿";
  blocks.sort((a, b) => themeOf(a).localeCompare(themeOf(b)));
}

/**
 * Order channels in place. "updated" (default) reuses the shared
 * most-recently-connected comparator from lib/channels so the home view and
 * the recent-channels picker stay consistent.
 */
function sortChannels(
  channels: (ChannelWithBlocks & { last_connected_at: string | null })[],
  order: OrderKind
): void {
  switch (order) {
    case "newest":
      channels.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      break;
    case "oldest":
      channels.sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      break;
    case "alphabetical":
      channels.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case "connections":
      channels.sort((a, b) => b.block_count - a.block_count);
      break;
    case "random":
      shuffle(channels);
      break;
    case "updated":
    default:
      channels.sort(compareChannelRecency);
      break;
  }
}

/**
 * Server component for the live search view — runs when `?q=` is present and
 * fills the main view with matches (concepts, then channels, then a block grid).
 *
 * Blocks are matched with Postgres full-text search via the `search_blocks` RPC
 * (ranked + stemmed, so "graphs" finds "graph"). If the RPC is unavailable
 * (migration 0006 not yet applied) or returns nothing, we fall back to the
 * legacy `ilike` substring scan so partial-token search still works. Concepts
 * and channels are matched with a simple `ilike` (small tables). `q` is
 * sanitised of the characters that would break a PostgREST `.or()` filter
 * string (`% , ( )`) before interpolation into those fallback queries.
 */
async function SearchRoute({ q }: { q: string }) {
  if (!supabase) return null;
  const client = supabase;

  const safe = q.replace(/[%,()]/g, " ").trim();
  if (!safe) {
    return (
      <div className="px-5 py-16 text-sm text-neutral-500">
        Type to search your blocks, concepts and channels.
      </div>
    );
  }
  const pattern = `%${safe}%`;

  // Full-text block search first; fall back to ilike when empty/unavailable.
  let blocks: Item[] = [];
  const ftsRes = await client.rpc("search_blocks", { q: q.trim(), lim: 100 });
  if (!ftsRes.error && Array.isArray(ftsRes.data)) {
    blocks = ftsRes.data as Item[];
  }
  if (blocks.length === 0) {
    const { data } = await client
      .from("items")
      .select("*")
      .or(
        `title.ilike.${pattern},description.ilike.${pattern},url.ilike.${pattern},source_name.ilike.${pattern},body_text.ilike.${pattern}`
      )
      .order("created_at", { ascending: false })
      .limit(100);
    blocks = (data ?? []) as Item[];
  }

  const [conceptsRes, channelsRes] = await Promise.all([
    client
      .from("concepts")
      .select("id, slug, term, block_count")
      .ilike("term", pattern)
      .order("block_count", { ascending: false })
      .limit(12),
    client
      .from("channels")
      .select("id, slug, title, description")
      .or(`title.ilike.${pattern},description.ilike.${pattern}`)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  type ConceptHit = { id: string; slug: string; term: string; block_count: number };
  const concepts = (conceptsRes.data ?? []) as ConceptHit[];
  const channels = (channelsRes.data ?? []) as Pick<
    Channel,
    "id" | "slug" | "title" | "description"
  >[];
  const total = blocks.length + channels.length + concepts.length;

  return (
    <>
      <p className="px-5 pt-6 pb-2 text-sm text-neutral-500">
        {total === 0
          ? "No results"
          : `${total} result${total === 1 ? "" : "s"}`}{" "}
        for <span className="text-neutral-200">“{q}”</span>
      </p>

      {concepts.length > 0 && (
        <section className="px-5 pb-8 pt-4">
          <h2 className="mb-3 text-xs uppercase tracking-wide text-neutral-500">
            Concepts
          </h2>
          <ul className="flex flex-wrap gap-2">
            {concepts.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/concept/${c.slug}`}
                  className="inline-flex items-baseline gap-1.5 rounded-full border border-neutral-800 bg-neutral-900 px-3 py-1 text-sm text-neutral-200 hover:border-neutral-600 hover:text-white"
                >
                  {c.term}
                  <span className="text-xs text-neutral-500">
                    {c.block_count}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {channels.length > 0 && (
        <section className="px-5 pb-8 pt-4">
          <h2 className="mb-3 text-xs uppercase tracking-wide text-neutral-500">
            Channels
          </h2>
          <ul className="flex flex-col gap-2">
            {channels.map((c) => (
              <li key={c.id} className="flex items-baseline gap-2">
                <Link
                  href={`/channel/${c.slug}`}
                  className="text-neutral-200 hover:text-white hover:underline"
                >
                  {c.title}
                </Link>
                {c.description && (
                  <span className="truncate text-xs text-neutral-500">
                    {c.description}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {blocks.length > 0 && (
        <section>
          <h2 className="px-5 pb-3 pt-4 text-xs uppercase tracking-wide text-neutral-500">
            Blocks
          </h2>
          <BlocksView blocks={blocks} />
        </section>
      )}
    </>
  );
}
