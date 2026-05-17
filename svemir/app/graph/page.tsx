import Link from "next/link";
import { supabase } from "@/lib/supabase-client";
import KnowledgeGraph, { type GraphItem } from "@/components/KnowledgeGraph";

export const revalidate = 60;

type ChannelRef = { id: string; title: string };

type GraphRow = {
  id: string;
  title: string;
  categories: string[] | null;
  connections: { channels: unknown }[] | null;
};

function asChannelList(raw: unknown): ChannelRef[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as ChannelRef[];
  return [raw as ChannelRef];
}

export default async function GraphPage() {
  if (!supabase) {
    return (
      <div className="p-8 text-zinc-400 bg-[#0a0a0a] min-h-screen">
        Supabase is not configured.
      </div>
    );
  }

  const { data, error } = await supabase
    .from("items")
    .select("id, title, categories, connections(channels(id, title))");

  if (error) {
    return (
      <div className="p-8 text-red-400 bg-[#0a0a0a] min-h-screen">
        Failed to load graph: {error.message}
      </div>
    );
  }

  const items: GraphItem[] = ((data ?? []) as unknown as GraphRow[]).map(
    (row) => {
      const channelPairs = (row.connections ?? []).flatMap((c) =>
        asChannelList(c.channels)
      );
      return {
        id: row.id,
        title: row.title,
        category: row.categories?.[0] ?? null,
        tagIds: channelPairs.map((c) => c.id),
        tagNames: channelPairs.map((c) => c.title),
      };
    }
  );

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-200">
      <header className="border-b border-neutral-800">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <Link
            href="/"
            className="text-sm text-neutral-400 hover:text-neutral-100"
          >
            ← svemir
          </Link>
          <p className="text-xs text-neutral-500">
            {items.length} {items.length === 1 ? "block" : "blocks"} · click a
            node to open
          </p>
        </div>
      </header>
      {items.length === 0 ? (
        <div className="flex h-[calc(100vh-4rem)] items-center justify-center text-sm text-neutral-500">
          No blocks yet — add some from /admin.
        </div>
      ) : (
        <KnowledgeGraph items={items} />
      )}
    </div>
  );
}
