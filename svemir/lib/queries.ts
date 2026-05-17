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

  const { data, error } = await supabase
    .from("items")
    .select("*, connections(channels(*))")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as unknown as BlockRow;
  const { connections, ...rest } = row;
  const channels = (connections ?? []).flatMap((c) =>
    asChannelList(c.channels)
  );
  return { ...rest, channels };
}
