import Link from "next/link";
import { supabase } from "@/lib/supabase-client";
import ChannelCard from "@/components/ChannelCard";
import type { Channel } from "@/lib/types";

export const revalidate = 60;

type ChannelRow = Channel & {
  item_channels:
    | {
        added_at: string;
        items: { image_url: string | null } | null;
      }[]
    | null;
};

export default async function ChannelsPage() {
  if (!supabase) {
    return (
      <div className="p-8 text-zinc-600">Supabase is not configured.</div>
    );
  }

  const { data, error } = await supabase
    .from("channels")
    .select(
      "*, item_channels(added_at, items(image_url))"
    )
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <div className="p-8 text-red-600">
        Failed to load channels: {error.message}
      </div>
    );
  }

  const channels = ((data ?? []) as ChannelRow[]).map((row) => {
    const memberships = row.item_channels ?? [];
    const sorted = [...memberships].sort((a, b) =>
      a.added_at < b.added_at ? 1 : -1
    );
    const thumbnails = sorted
      .map((m) => m.items?.image_url ?? null)
      .filter((u): u is string | null => u !== undefined);
    return {
      channel: {
        id: row.id,
        name: row.name,
        slug: row.slug,
        description: row.description,
        cover_image_url: row.cover_image_url,
        created_at: row.created_at,
      } as Channel,
      itemCount: memberships.length,
      thumbnails,
    };
  });

  return (
    <div className="min-h-screen bg-[#FBF8F4]">
      <header className="border-b border-zinc-200">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link
            href="/archive"
            className="text-sm text-zinc-500 hover:text-zinc-900"
          >
            ← Archive
          </Link>
          <h1 className="text-sm font-medium text-zinc-700">
            Channels{" "}
            <span className="ml-1 text-zinc-400">{channels.length}</span>
          </h1>
          <Link
            href="/admin"
            className="text-sm text-zinc-500 hover:text-zinc-900"
          >
            + Add
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">
        {channels.length === 0 ? (
          <div className="flex min-h-[40vh] items-center justify-center text-sm text-zinc-500">
            No channels yet — start one by adding an item from{" "}
            <Link href="/admin" className="ml-1 underline">
              /admin
            </Link>
            .
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {channels.map(({ channel, itemCount, thumbnails }) => (
              <ChannelCard
                key={channel.id}
                channel={channel}
                itemCount={itemCount}
                thumbnails={thumbnails}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
