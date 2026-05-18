import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { supabase } from "@/lib/supabase-client";
import TopBar from "@/components/TopBar";
import BlocksView from "@/components/BlocksView";
import type { Channel, ChannelWithBlocks, Item } from "@/lib/types";
import ChannelCard from "@/components/ChannelCard";

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
  // round-trip pattern with a single PostgREST request.
  type ChannelWithConns = Channel & {
    connections: { position: number; items: unknown }[] | null;
  };
  type ChannelWithKids = ChannelWithConns & {
    children: ChannelWithConns[] | null;
  };

  const { data: channelRow } = await client
    .from("channels")
    .select(
      "*, connections(position, items(*)), children:channels!parent_id(*, connections(position, items(*)))"
    )
    .eq("slug", slug)
    .maybeSingle();

  if (!channelRow) notFound();
  const parent = channelRow as unknown as ChannelWithKids;
  const { connections: parentConns, children, ...channelBase } = parent;
  const channel = channelBase as Channel;

  function blocksFromConns(
    conns: { position: number; items: unknown }[] | null
  ): Item[] {
    return (conns ?? [])
      .map((row) => {
        const it = row.items;
        const item = Array.isArray(it) ? it[0] : it;
        return { position: row.position, item: item as Item | undefined };
      })
      .filter((r): r is { position: number; item: Item } => !!r.item)
      .sort((a, b) => a.position - b.position)
      .map((r) => r.item);
  }

  const blocks: Item[] = blocksFromConns(parentConns);

  const childrenWithBlocks: ChannelWithBlocks[] = (children ?? [])
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
    .map((c) => {
      const childBlocks = blocksFromConns(c.connections);
      return {
        ...(c as Channel),
        blocks: childBlocks.slice(0, 8),
        block_count: childBlocks.length,
      } satisfies ChannelWithBlocks;
    });

  return (
    <>
      <TopBar />
      {channel.cover_url && (
        <div className="relative aspect-[16/5] w-full overflow-hidden border-b border-neutral-900 bg-neutral-900">
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
      <div className="border-b border-neutral-900">
        <div className="px-5 pt-8 pb-6">
          <h1 className="flex items-baseline gap-3">
            <Link
              href="/"
              className="font-[family-name:var(--font-display)] text-3xl tracking-wider text-neutral-500 hover:text-neutral-200"
            >
              svemir
            </Link>
            <span className="text-neutral-700">/</span>
            <span className="text-3xl font-light text-neutral-100">
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
