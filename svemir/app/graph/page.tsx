import { supabase } from "@/lib/supabase-client";
import TopBar from "@/components/TopBar";
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
      <>
        <TopBar />
        <main className="p-8 text-sm text-neutral-400">
          Supabase is not configured.
        </main>
      </>
    );
  }

  const { data, error } = await supabase
    .from("items")
    .select("id, title, categories, connections(channels(id, title))");

  if (error) {
    return (
      <>
        <TopBar />
        <main className="p-8 text-sm text-red-400">
          Failed to load graph: {error.message}
        </main>
      </>
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
    <>
      <TopBar />
      {items.length === 0 ? (
        <main className="flex h-[calc(100vh-3rem)] items-center justify-center text-sm text-neutral-500">
          No blocks yet — add some from <code className="ml-1 rounded bg-neutral-900 px-1">/admin</code>.
        </main>
      ) : (
        <KnowledgeGraph items={items} />
      )}
    </>
  );
}
