import { supabase } from "@/lib/supabase-client";
import TopBar from "@/components/TopBar";
import GardenShell from "@/components/GardenShell";
import type {
  GardenChannel,
  GardenRoot,
  RootTerm,
} from "@/components/IdeaGarden";
import type { CloudConcept } from "@/components/ConceptCloud";
import { channelColor } from "@/lib/constants";

export const revalidate = 60;

// Concept budget for the panel's cloud. 500 was the standalone /concepts
// page's budget; the panel inherits it (the old 220 cap existed only to keep
// the Map's force simulation legible).
const MAX_CONCEPTS = 500;

// Root density cap: how many roots may touch one channel before weaker pairs
// are dropped. Each channel always keeps its strongest pair regardless, so no
// planted channel with any overlap reads as isolated.
const MAX_ROOTS_PER_CHANNEL = 4;

type PairRow = {
  channel_a: string;
  channel_b: string;
  weight: number;
  shared_count: number;
  top_terms: string[] | null;
  top_slugs: string[] | null;
};

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

  const [{ data: channelData, error }, { data: conceptRows }, pairsRes] =
    await Promise.all([
      // Garden: each channel + its blocks (oldest→newest decided below).
      supabase
        .from("channels")
        .select("id, slug, title, connections(items(id, title, created_at))"),
      supabase
        .from("concepts")
        .select("id, slug, term, block_count")
        .gte("block_count", 2) // 2+ blocks: a one-block term is a tag, not a thread
        .order("block_count", { ascending: false })
        .limit(MAX_CONCEPTS),
      // Roots: channel pairs that share concepts (migration 0013). SECURITY
      // INVOKER, so anon RLS keeps private channels out. Errors (including
      // "the migration hasn't been run yet") degrade to zero roots below,
      // matching the rpc house pattern in lib/channels.ts.
      supabase.rpc("channel_concept_pairs", { min_shared: 1, per_pair_terms: 5 }),
    ]);

  if (error) {
    return (
      <>
        <TopBar />
        <main className="p-8 text-sm text-red-400">
          Failed to load the garden: {error.message}
        </main>
      </>
    );
  }

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
        color: channelColor(row.id),
        leaves,
      };
    })
    .filter((g) => g.leaves.length > 0);

  // Shape the RPC rows into GardenRoots: keep pairs whose BOTH endpoints are
  // planted, normalize weight against the strongest pair, then thin greedily
  // (strongest first) so no tree drowns under too many roots.
  const gardenIds = new Set(gardens.map((g) => g.id));
  const pairRows =
    pairsRes.error || !pairsRes.data ? [] : (pairsRes.data as PairRow[]);
  const candidates = pairRows
    .filter((r) => gardenIds.has(r.channel_a) && gardenIds.has(r.channel_b))
    .sort((x, y) => y.weight - x.weight);
  const maxWeight = candidates[0]?.weight || 1;
  const degree = new Map<string, number>();
  const roots: GardenRoot[] = [];
  for (const r of candidates) {
    const da = degree.get(r.channel_a) ?? 0;
    const db = degree.get(r.channel_b) ?? 0;
    // A channel's first appearance in this desc order IS its strongest pair,
    // so it is always kept even when the other endpoint is already full.
    const firstForEither = da === 0 || db === 0;
    if (
      !firstForEither &&
      (da >= MAX_ROOTS_PER_CHANNEL || db >= MAX_ROOTS_PER_CHANNEL)
    )
      continue;
    const slugs = r.top_slugs ?? [];
    const terms: RootTerm[] = (r.top_terms ?? [])
      .map((term, i) => ({ term, slug: slugs[i] ?? "" }))
      .filter((t) => t.slug);
    roots.push({
      a: r.channel_a,
      b: r.channel_b,
      weight: r.weight / maxWeight,
      sharedCount: r.shared_count,
      terms,
    });
    degree.set(r.channel_a, da + 1);
    degree.set(r.channel_b, db + 1);
  }

  const concepts: CloudConcept[] = (
    (conceptRows ?? []) as {
      id: string;
      slug: string;
      term: string;
      block_count: number;
    }[]
  ).map((c) => ({ id: c.id, slug: c.slug, term: c.term, count: c.block_count }));

  return (
    <>
      <TopBar />
      {gardens.length === 0 ? (
        <main className="flex h-[calc(100vh-3rem)] items-center justify-center text-sm text-neutral-500">
          No channels with blocks yet - add some from{" "}
          <code className="ml-1 rounded bg-neutral-900 px-1">/admin</code>.
        </main>
      ) : (
        <GardenShell gardens={gardens} roots={roots} concepts={concepts} />
      )}
    </>
  );
}
