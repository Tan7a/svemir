import { supabase } from "@/lib/supabase-client";
import TopBar from "@/components/TopBar";
import FilterBar, {
  type ViewKind,
  type OrderKind,
} from "@/components/FilterBar";
import BlocksView from "@/components/BlocksView";
import ChannelsView from "@/components/ChannelsView";
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
  connections: "connections",
  random: "random",
};

type SP = Promise<{
  view?: string;
  order?: string;
}>;

export default async function Home({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const view: ViewKind =
    (sp.view && ALLOWED_VIEWS[sp.view]) || "channels";
  const order: OrderKind =
    (sp.order && ALLOWED_ORDERS[sp.order]) || "newest";

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
        <div className="px-5 pt-8 pb-4">
          <h1 className="font-[family-name:var(--font-display)] text-6xl tracking-wider text-neutral-100">
            svemir
          </h1>
        </div>
        <FilterBar
          view={view}
          order={order}
          blockCount={blockCount ?? 0}
          channelCount={channelCount ?? 0}
        />
      </div>

      <main>
        {view === "blocks" ? (
          <BlocksRoute order={order} />
        ) : (
          <ChannelsRoute />
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
  return <BlocksView blocks={(data ?? []) as Item[]} />;
}

/** Server component fetching channels + their first ~5 blocks each. */
async function ChannelsRoute() {
  if (!supabase) return null;
  const client = supabase;

  const { data: chData, error: chErr } = await client
    .from("channels")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);

  if (chErr) {
    return (
      <div className="p-8 text-sm text-red-400">
        Failed to load channels: {chErr.message}
      </div>
    );
  }

  const channels = (chData ?? []) as Channel[];
  if (channels.length === 0) {
    return <ChannelsView channels={[]} />;
  }

  // For each channel, fetch its first ~5 blocks + a count, in parallel.
  // ~50 parallel queries at personal scale; Supabase handles fine.
  const enriched = await Promise.all(
    channels.map(async (c) => {
      const [{ data: conns }, { count }] = await Promise.all([
        client
          .from("connections")
          .select("position, items(*)")
          .eq("channel_id", c.id)
          .order("position", { ascending: true })
          .limit(8),
        client
          .from("connections")
          .select("block_id", { count: "exact", head: true })
          .eq("channel_id", c.id),
      ]);

      const blocks: Item[] = (conns ?? [])
        .map((row: { items: unknown }) => {
          const it = row.items;
          if (Array.isArray(it)) return it[0] as Item | undefined;
          return it as Item | undefined;
        })
        .filter((b): b is Item => !!b);

      return {
        ...c,
        blocks,
        block_count: count ?? blocks.length,
      } satisfies ChannelWithBlocks;
    })
  );

  return <ChannelsView channels={enriched} />;
}
