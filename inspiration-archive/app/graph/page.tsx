import Link from "next/link";
import { supabase } from "@/lib/supabase-client";
import KnowledgeGraph, { type GraphItem } from "@/components/KnowledgeGraph";

export const revalidate = 60;

type TagRef = { id: string; name: string };

type GraphRow = {
  id: string;
  title: string;
  categories: string[] | null;
  item_tags: { tags: unknown }[] | null;
};

function asTagList(raw: unknown): TagRef[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as TagRef[];
  return [raw as TagRef];
}

export default async function GraphPage() {
  if (!supabase) {
    return (
      <div className="p-8 text-zinc-600">
        Supabase is not configured.
      </div>
    );
  }

  const { data, error } = await supabase
    .from("items")
    .select("id, title, categories, item_tags(tags(id, name))");

  if (error) {
    return (
      <div className="p-8 text-red-600">
        Failed to load graph: {error.message}
      </div>
    );
  }

  const items: GraphItem[] = ((data ?? []) as unknown as GraphRow[]).map(
    (row) => {
      const tagPairs = (row.item_tags ?? []).flatMap((it) => asTagList(it.tags));
      return {
        id: row.id,
        title: row.title,
        category: row.categories?.[0] ?? null,
        tagIds: tagPairs.map((t) => t.id),
        tagNames: tagPairs.map((t) => t.name),
      };
    }
  );

  return (
    <div className="min-h-screen bg-[#FBF8F4]">
      <header className="border-b border-zinc-200">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <Link
            href="/archive"
            className="text-sm text-zinc-600 hover:text-zinc-900"
          >
            ← Archive
          </Link>
          <p className="text-xs text-zinc-500">
            {items.length} {items.length === 1 ? "item" : "items"} · click a
            node to open
          </p>
        </div>
      </header>
      {items.length === 0 ? (
        <div className="flex h-[calc(100vh-4rem)] items-center justify-center text-sm text-zinc-500">
          No items yet — add some from /admin.
        </div>
      ) : (
        <KnowledgeGraph items={items} />
      )}
    </div>
  );
}
