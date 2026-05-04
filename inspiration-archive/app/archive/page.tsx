import { supabase } from "@/lib/supabase-client";
import ArchiveGrid from "@/components/ArchiveGrid";
import type { Item, Tag, ItemWithTags } from "@/lib/types";

export const revalidate = 60;

type ItemRow = Item & {
  item_tags: { tags: Tag | null }[] | null;
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
    .select("*, item_tags(tags(*))")
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <div className="p-8 text-red-600">
        Failed to load items: {error.message}
      </div>
    );
  }

  const items: ItemWithTags[] = ((data ?? []) as ItemRow[]).map((row) => {
    const { item_tags, ...item } = row;
    const tags: Tag[] = (item_tags ?? [])
      .map((it) => it.tags)
      .filter((t): t is Tag => !!t);
    return { ...item, tags };
  });

  return <ArchiveGrid items={items} />;
}
