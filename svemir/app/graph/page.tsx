import { Suspense } from "react";
import { supabase } from "@/lib/supabase-client";
import TopBar from "@/components/TopBar";
import GraphViewSwitcher from "@/components/GraphViewSwitcher";
import type { GardenChannel } from "@/components/IdeaGarden";
import {
  type GraphItem,
  type GraphConcept,
  type BlockConceptLink,
} from "@/components/KnowledgeGraph";
import { hueFromId } from "@/lib/constants";

export const revalidate = 60;

// Cap concept nodes shown in the graph — keeps the force simulation legible.
const MAX_CONCEPT_NODES = 150;

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

  const [
    { data, error },
    { data: edgeRows },
    { data: conceptRows },
    { data: channelData },
  ] = await Promise.all([
    supabase
      .from("items")
      .select("id, title, categories, connections(channels(id, title))"),
    supabase.from("block_connections").select("a_id, b_id"),
    supabase
      .from("concepts")
      .select("id, slug, term, block_count")
      .gte("block_count", 2) // only concepts that actually link 2+ blocks
      .order("block_count", { ascending: false })
      .limit(MAX_CONCEPT_NODES),
    // Garden: each channel + its blocks (oldest→newest decided below).
    supabase
      .from("channels")
      .select("id, slug, title, connections(items(id, title, created_at))"),
  ]);

  // Block→concept links, restricted to the capped concept set above.
  const concepts: GraphConcept[] = (
    (conceptRows ?? []) as {
      id: string;
      slug: string;
      term: string;
      block_count: number;
    }[]
  ).map((c) => ({
    id: c.id,
    slug: c.slug,
    term: c.term,
    blockCount: c.block_count,
  }));

  let blockConceptLinks: BlockConceptLink[] = [];
  if (concepts.length > 0) {
    const { data: bcRows } = await supabase
      .from("block_concepts")
      .select("block_id, concept_id, tf")
      .in(
        "concept_id",
        concepts.map((c) => c.id)
      );
    blockConceptLinks = ((bcRows ?? []) as {
      block_id: string;
      concept_id: string;
      tf: number;
    }[]).map((r) => ({
      blockId: r.block_id,
      conceptId: r.concept_id,
      weight: r.tf,
    }));
  }

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

  const manualEdges = (edgeRows ?? []).map((e) => ({
    a: e.a_id as string,
    b: e.b_id as string,
  }));

  // Garden data: one plant per channel; leaves = blocks oldest→newest.
  type GardenRow = {
    id: string;
    slug: string;
    title: string;
    connections: { items: unknown }[] | null;
  };
  type LeafRow = { id: string; title: string; created_at: string };
  const gardens: GardenChannel[] = ((channelData ?? []) as unknown as GardenRow[])
    .map((row) => {
      const leaves = (row.connections ?? [])
        .map((c) => {
          const it = c.items;
          return (Array.isArray(it) ? it[0] : it) as LeafRow | undefined;
        })
        .filter((it): it is LeafRow => !!it)
        .sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        )
        .map((it) => ({ id: it.id, title: it.title, createdAt: it.created_at }));
      return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        hue: hueFromId(row.id),
        leaves,
      };
    })
    .filter((g) => g.leaves.length > 0);

  return (
    <>
      <TopBar />
      {items.length === 0 ? (
        <main className="flex h-[calc(100vh-3rem)] items-center justify-center text-sm text-neutral-500">
          No blocks yet — add some from <code className="ml-1 rounded bg-neutral-900 px-1">/admin</code>.
        </main>
      ) : (
        <Suspense fallback={<div className="h-[calc(100vh-3rem)]" />}>
          <GraphViewSwitcher
            gardens={gardens}
            graphProps={{ items, manualEdges, concepts, blockConceptLinks }}
          />
        </Suspense>
      )}
    </>
  );
}
