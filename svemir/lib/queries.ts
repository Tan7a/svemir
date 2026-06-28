import { supabase } from "./supabase-client";
import type {
  Channel,
  Item,
  ItemWithChannels,
  PaperFacet,
  FacetPaper,
  FacetWithPapers,
} from "./types";

type BlockRow = Item & {
  connections: { channels: unknown }[] | null;
};

function asChannelList(raw: unknown): Channel[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as Channel[];
  return [raw as Channel];
}

/**
 * Fetch a single block by id, with the list of channels it's connected to.
 * Returns `null` if not found or if Supabase isn't configured.
 *
 * Used by `/block/[id]` (full page) and `/@modal/(.)block/[id]` (modal).
 */
export async function getBlockWithChannels(
  id: string
): Promise<ItemWithChannels | null> {
  if (!supabase) return null;
  const client = supabase;

  // Round 1 (parallel): the item+channels join and the block_connections
  // edges are independent — fire both at once.
  const [
    { data, error },
    { data: edgeRows },
  ] = await Promise.all([
    client
      .from("items")
      .select("*, connections(channels(*))")
      .eq("id", id)
      .maybeSingle(),
    client
      .from("block_connections")
      .select("a_id, b_id")
      .or(`a_id.eq.${id},b_id.eq.${id}`),
  ]);

  if (error || !data) return null;

  const row = data as unknown as BlockRow;
  const { connections, ...rest } = row;
  const channels = (connections ?? []).flatMap((c) =>
    asChannelList(c.channels)
  );

  // Round 2: connected items resolved from the edge rows. Skipped entirely
  // when there are no manual connections so most blocks pay only one
  // round-trip total.
  const otherIds = (edgeRows ?? []).map((e) =>
    (e.a_id as string) === id ? (e.b_id as string) : (e.a_id as string)
  );

  let connected_blocks: Item[] = [];
  if (otherIds.length > 0) {
    const { data: blocks } = await client
      .from("items")
      .select("*")
      .in("id", otherIds);
    connected_blocks = (blocks ?? []) as Item[];
  }

  return { ...rest, channels, connected_blocks };
}

/** All facets (anon/public), ordered by prevalence — for the /facets index. */
export async function listFacets(): Promise<PaperFacet[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from("paper_facets")
    .select("id, dimension, value, slug, definition, paper_count")
    .order("paper_count", { ascending: false })
    .order("value", { ascending: true });
  return (data ?? []) as PaperFacet[];
}

/**
 * A facet by slug with the papers that carry it and each paper's note (how that
 * paper relates to the facet). Anon/public — facets are select-using(true).
 */
export async function getFacetWithPapers(
  slug: string
): Promise<FacetWithPapers | null> {
  if (!supabase) return null;
  const { data: facet } = await supabase
    .from("paper_facets")
    .select("id, dimension, value, slug, definition, paper_count")
    .eq("slug", slug)
    .maybeSingle();
  if (!facet) return null;

  const { data: links } = await supabase
    .from("paper_facet_links")
    .select("note, items(id, title, paper_authors, paper_year)")
    .eq("facet_id", (facet as PaperFacet).id);

  const papers: FacetPaper[] = (links ?? [])
    .map((l) => {
      const raw = (l as { items: unknown }).items;
      const it = (Array.isArray(raw) ? raw[0] : raw) as
        | { id: string; title: string; paper_authors: string[] | null; paper_year: number | null }
        | null;
      if (!it) return null;
      return {
        id: it.id,
        title: it.title,
        paper_authors: it.paper_authors,
        paper_year: it.paper_year,
        note: (l as { note: string | null }).note,
      };
    })
    .filter((p): p is FacetPaper => p !== null)
    .sort(
      (a, b) =>
        (b.paper_year ?? 0) - (a.paper_year ?? 0) || a.title.localeCompare(b.title)
    );

  return { ...(facet as PaperFacet), papers };
}

/** Paper ids carrying a facet (by slug) — for filtering the grid by ?facet=. */
export async function paperIdsForFacet(slug: string): Promise<string[]> {
  if (!supabase) return [];
  const { data: facet } = await supabase
    .from("paper_facets")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (!facet) return [];
  const { data: links } = await supabase
    .from("paper_facet_links")
    .select("paper_id")
    .eq("facet_id", (facet as { id: string }).id);
  return (links ?? []).map((l) => (l as { paper_id: string }).paper_id);
}
