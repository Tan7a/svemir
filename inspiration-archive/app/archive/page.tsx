import { supabase } from "@/lib/supabase-client";
import ArchiveGrid from "@/components/ArchiveGrid";
import type { Item, Channel, ItemWithChannels } from "@/lib/types";

export const revalidate = 60;

type ItemRow = Item & {
  item_channels: { channels: Channel | null }[] | null;
};

export default async function ArchivePage() {
  if (!supabase) {
    return (
      <div className="p-8 text-zinc-600">
        Supabase is not configured. Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
        <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to <code>.env.local</code>.
      </div>
    );
  }

  const { data, error } = await supabase
    .from("items")
    .select("*, item_channels(channels(*))")
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <div className="p-8 text-red-600">
        Failed to load items: {error.message}
      </div>
    );
  }

  const items: ItemWithChannels[] = ((data ?? []) as ItemRow[]).map((row) => {
    const { item_channels, ...item } = row;
    const channels: Channel[] = (item_channels ?? [])
      .map((it) => it.channels)
      .filter((c): c is Channel => !!c);
    return { ...item, channels };
  });

  return <ArchiveGrid items={items} />;
}
