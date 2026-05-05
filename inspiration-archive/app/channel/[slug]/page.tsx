import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase-client";
import ChannelPage from "@/components/ChannelPage";
import type { Channel, Item, ItemWithChannels } from "@/lib/types";

export const revalidate = 60;

type ItemRow = Item & {
  item_channels: { channels: Channel | null }[] | null;
};

type ChannelRow = Channel & {
  item_channels:
    | {
        position: number;
        added_at: string;
        items: ItemRow | null;
      }[]
    | null;
};

export default async function ChannelDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  if (!supabase) {
    return (
      <div className="p-8 text-zinc-600">Supabase is not configured.</div>
    );
  }

  const { data: channelRow, error } = await supabase
    .from("channels")
    .select(
      `
      *,
      item_channels (
        position,
        added_at,
        items (
          *,
          item_channels (
            channels (*)
          )
        )
      )
      `
    )
    .eq("slug", slug)
    .maybeSingle<ChannelRow>();

  if (error) {
    return (
      <div className="p-8 text-red-600">
        Failed to load channel: {error.message}
      </div>
    );
  }

  if (!channelRow) notFound();

  const memberships = channelRow.item_channels ?? [];
  const sorted = [...memberships].sort((a, b) => {
    if (a.position !== b.position) return b.position - a.position;
    return a.added_at < b.added_at ? 1 : -1;
  });

  const items: ItemWithChannels[] = sorted
    .map((m) => m.items)
    .filter((it): it is ItemRow => !!it)
    .map((row) => {
      const { item_channels, ...rest } = row;
      const channels: Channel[] = (item_channels ?? [])
        .map((it) => it.channels)
        .filter((c): c is Channel => !!c);
      return { ...rest, channels };
    });

  const channel: Channel = {
    id: channelRow.id,
    name: channelRow.name,
    slug: channelRow.slug,
    description: channelRow.description,
    cover_image_url: channelRow.cover_image_url,
    created_at: channelRow.created_at,
  };

  return <ChannelPage channel={channel} items={items} />;
}
