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

  const { data: channelRow } = await client
    .from("channels")
    .select("id, slug, title, description, cover_url, parent_id, created_at")
    .eq("slug", slug)
    .maybeSingle();

  if (!channelRow) notFound();
  const channel = channelRow as Channel;

  const [{ data: rows }, { data: childRows }] = await Promise.all([
    client
      .from("connections")
      .select("position, items(*)")
      .eq("channel_id", channel.id)
      .order("position", { ascending: true }),
    client
      .from("channels")
      .select("*")
      .eq("parent_id", channel.id)
      .order("created_at", { ascending: false }),
  ]);

  const blocks: Item[] = (rows ?? [])
    .map((row: { items: unknown }) => {
      const it = row.items;
      if (Array.isArray(it)) return it[0] as Item | undefined;
      return it as Item | undefined;
    })
    .filter((b): b is Item => !!b);

  const childChannels = (childRows ?? []) as Channel[];

  // Enrich each child channel with its first ~25 thumbs + total count, so the
  // nested ChannelCard renders correctly.
  const childrenWithBlocks: ChannelWithBlocks[] = await Promise.all(
    childChannels.map(async (c) => {
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
      const innerBlocks: Item[] = (conns ?? [])
        .map((row: { items: unknown }) => {
          const it = row.items;
          if (Array.isArray(it)) return it[0] as Item | undefined;
          return it as Item | undefined;
        })
        .filter((b): b is Item => !!b);
      return {
        ...c,
        blocks: innerBlocks,
        block_count: count ?? innerBlocks.length,
      } satisfies ChannelWithBlocks;
    })
  );

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
