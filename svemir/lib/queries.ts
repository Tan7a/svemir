import { supabase } from "./supabase-client";
import type { Channel, Item, ItemWithChannels } from "./types";

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
