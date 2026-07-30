import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { supabase } from "@/lib/supabase-client";
import TopBar from "@/components/TopBar";
import BlocksView from "@/components/BlocksView";
import { ITEM_CARD_COLUMNS } from "@/lib/types";
import type { CardItem, Channel, ChannelWithBlocks } from "@/lib/types";
import ChannelCard from "@/components/ChannelCard";
import ChannelActions from "@/components/ChannelActions";

export const revalidate = 60;

type Params = Promise<{ slug: string }>;

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? "" : "s"} ago`;
  const yr = Math.floor(mo / 12);
  return `${yr} year${yr === 1 ? "" : "s"} ago`;
}

export default async function ChannelPage({ params }: { params: Params }) {
  const { slug } = await params;

  if (!supabase) {
    return (
      <>
        <TopBar />
        <main className="p-8 text-sm text-neutral-400">
          Supabase is not configured.
        </main>
      </>
    );
  }
  const client = supabase;

  // Parent + connections + children + their connections in ONE query via
  // Supabase's nested-select self-join. Replaces the previous 1 + 1 + N×2
  // round-trip pattern with a single PostgREST request. Card columns only
  // (no body_text/search_tsv); children fetch just the 8 cover cards their
  // strip renders, with the true count from an aliased count embed.
  type ChannelWithConns = Channel & {
    connections:
      | { position: number; connected_at: string; items: unknown }[]
      | null;
  };
  type ChildRow = Channel & {
    covers: { position: number; items: unknown }[] | null;
    meta: { count: number }[] | null;
  };
  type ChannelWithKids = ChannelWithConns & {
    children: ChildRow[] | null;
  };

  const { data: channelRow } = await client
    .from("channels")
    .select(
      `*,
       connections(position, connected_at, items(${ITEM_CARD_COLUMNS})),
       children:channels!parent_id(*, covers:connections(position, items(${ITEM_CARD_COLUMNS})), meta:connections(count))`
    )
    .eq("slug", slug)
    .order("position", { referencedTable: "children.covers", ascending: true })
    .limit(8, { referencedTable: "children.covers" })
    .maybeSingle();

  if (!channelRow) notFound();
  const parent = channelRow as unknown as ChannelWithKids;
  const { connections: parentConns, children, ...channelBase } = parent;
  const channel = channelBase as Channel;

  function blocksFromConns(
    conns: { position: number; items: unknown }[] | null
  ): CardItem[] {
    return (conns ?? [])
      .map((row) => {
        const it = row.items;
        const item = Array.isArray(it) ? it[0] : it;
        return { position: row.position, item: item as CardItem | undefined };
      })
      .filter((r): r is { position: number; item: CardItem } => !!r.item)
      .sort((a, b) => a.position - b.position)
      .map((r) => r.item);
  }

  const blocks: CardItem[] = blocksFromConns(parentConns);

  // Info-popup extras, mirroring what ChannelCard derives for the card menu.
  // Every connection row is already fetched here (no limit), so the most recent
  // connected_at is a free reduction rather than a second query.
  const lastUpdated = (parentConns ?? []).reduce<string | null>((max, row) => {
    const at = row.connected_at;
    if (!at) return max;
    return !max || new Date(at).getTime() > new Date(max).getTime() ? at : max;
  }, null);

  const topicCounts = new Map<string, number>();
  for (const b of blocks) {
    for (const c of b.categories ?? []) {
      topicCounts.set(c, (topicCounts.get(c) ?? 0) + 1);
    }
  }
  const topics = [...topicCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([c]) => c);

  const childrenWithBlocks: ChannelWithBlocks[] = (children ?? [])
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
    .map((c) => {
      const { covers, meta, ...base } = c;
      return {
        ...(base as Channel),
        blocks: blocksFromConns(covers),
        block_count: meta?.[0]?.count ?? 0,
      } satisfies ChannelWithBlocks;
    });

  return (
    <>
      <TopBar />
      {channel.cover_url && (
        <div className="relative aspect-[16/5] w-full overflow-hidden bg-neutral-900">
          <Image
            src={channel.cover_url}
            alt=""
            fill
            sizes="100vw"
            className="object-cover"
            priority
          />
        </div>
      )}
      <div>
        <div className="flex items-start justify-between gap-4 px-5 pt-8 pb-6">
          <div>
            <h1 className="flex items-baseline gap-3">
              <Link
                href="/"
                className="font-[family-name:var(--font-display)] text-3xl tracking-wider text-neutral-500 hover:text-neutral-200"
              >
                svemir
              </Link>
              <span className="text-3xl text-neutral-700">/</span>
              <span className="font-[family-name:var(--font-display)] text-3xl tracking-wider text-neutral-100">
                {channel.title}
              </span>
            </h1>
            {channel.description && (
              <p className="mt-2 max-w-prose text-sm text-neutral-400">
                {channel.description}
              </p>
            )}
            <p className="mt-3 text-xs text-neutral-500">
              {blocks.length} block{blocks.length === 1 ? "" : "s"}
              {childrenWithBlocks.length > 0 && (
                <> · {childrenWithBlocks.length} nested channel{childrenWithBlocks.length === 1 ? "" : "s"}</>
              )}
              {" "}· created {relativeTime(channel.created_at)}
            </p>
          </div>

          {/* Same actions menu as the channel cards. Always visible here (no
              card to hover), and it renders null for signed-out visitors. */}
          <div className="shrink-0">
            <ChannelActions
              channelId={channel.id}
              channelTitle={channel.title}
              isPrivate={false}
              hasParent={channel.parent_id !== null}
              info={{
                description: channel.description,
                blockCount: blocks.length,
                createdAt: channel.created_at,
                lastUpdated,
                topics,
              }}
            />
          </div>
        </div>
      </div>

      <main>
        {childrenWithBlocks.length > 0 && (
          <section className="space-y-3 px-5 pt-8">
            <h2 className="text-xs uppercase tracking-wide text-neutral-500">
              Nested channels
            </h2>
            <div className="flex flex-col gap-10">
              {childrenWithBlocks.map((c) => (
                <ChannelCard key={c.id} channel={c} />
              ))}
            </div>
          </section>
        )}

        {blocks.length === 0 ? (
          childrenWithBlocks.length === 0 ? (
            <div className="px-5 py-16 text-center text-sm text-neutral-500">
              No blocks in this channel yet.
            </div>
          ) : null
        ) : (
          <div className="pt-8">
            <BlocksView blocks={blocks} />
          </div>
        )}
      </main>
    </>
  );
}
