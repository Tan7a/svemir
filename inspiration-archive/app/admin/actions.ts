"use server";

import { supabaseAdmin } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

function detectSourceType(url: string): string {
  if (url.includes("twitter.com") || url.includes("x.com")) return "x";
  if (url.includes("github.com")) return "github";
  if (url.includes("threads.net")) return "threads";
  if (url.includes("instagram.com")) return "instagram";
  if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
  if (url.includes("dribbble.com")) return "dribbble";
  return "website";
}

async function ensureChannelId(
  client: SupabaseClient,
  rawName: string
): Promise<string | null> {
  const name = rawName.trim();
  if (!name) return null;

  const { data: inserted, error: insertErr } = await client
    .from("channels")
    .insert({ name })
    .select("id")
    .single();

  if (!insertErr && inserted) return inserted.id as string;

  const { data: existing } = await client
    .from("channels")
    .select("id")
    .ilike("name", name)
    .maybeSingle();

  return (existing?.id as string) ?? null;
}

async function nextPositionInChannel(
  client: SupabaseClient,
  channelId: string
): Promise<number> {
  const { data } = await client
    .from("item_channels")
    .select("position")
    .eq("channel_id", channelId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  return ((data?.position as number | undefined) ?? -1) + 1;
}

export async function createChannel(
  name: string,
  description?: string
): Promise<
  | { success: true; channel: { id: string; name: string; slug: string } }
  | { success: false; error: string }
> {
  if (!supabaseAdmin) {
    return { success: false, error: "Supabase admin not configured" };
  }
  const trimmed = name.trim();
  if (!trimmed) return { success: false, error: "Channel name required" };

  const { data, error } = await supabaseAdmin
    .from("channels")
    .insert({ name: trimmed, description: description?.trim() || null })
    .select("id, name, slug")
    .single();

  if (error) {
    const { data: existing } = await supabaseAdmin
      .from("channels")
      .select("id, name, slug")
      .ilike("name", trimmed)
      .maybeSingle();
    if (existing) {
      return {
        success: true,
        channel: existing as { id: string; name: string; slug: string },
      };
    }
    return { success: false, error: error.message };
  }

  revalidatePath("/channels");
  return {
    success: true,
    channel: data as { id: string; name: string; slug: string },
  };
}

export async function renameChannel(
  id: string,
  name: string
): Promise<{ success: true } | { success: false; error: string }> {
  if (!supabaseAdmin) {
    return { success: false, error: "Supabase admin not configured" };
  }
  const trimmed = name.trim();
  if (!trimmed) return { success: false, error: "Name required" };
  const { error } = await supabaseAdmin
    .from("channels")
    .update({ name: trimmed })
    .eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/channels");
  revalidatePath("/archive");
  return { success: true };
}

export async function updateChannelDescription(
  id: string,
  description: string
): Promise<{ success: true } | { success: false; error: string }> {
  if (!supabaseAdmin) {
    return { success: false, error: "Supabase admin not configured" };
  }
  const { error } = await supabaseAdmin
    .from("channels")
    .update({ description: description.trim() || null })
    .eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/channels");
  return { success: true };
}

export async function deleteChannel(
  id: string
): Promise<{ success: true } | { success: false; error: string }> {
  if (!supabaseAdmin) {
    return { success: false, error: "Supabase admin not configured" };
  }
  const { error } = await supabaseAdmin.from("channels").delete().eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/channels");
  revalidatePath("/archive");
  revalidatePath("/graph");
  return { success: true };
}

async function connectItemToChannelsInternal(
  client: SupabaseClient,
  itemId: string,
  channelIds: string[]
): Promise<{ success: true } | { success: false; error: string }> {
  if (channelIds.length === 0) return { success: true };
  const rows: { item_id: string; channel_id: string; position: number }[] = [];
  for (const channelId of channelIds) {
    const position = await nextPositionInChannel(client, channelId);
    rows.push({ item_id: itemId, channel_id: channelId, position });
  }
  const { error } = await client.from("item_channels").upsert(rows, {
    onConflict: "item_id,channel_id",
    ignoreDuplicates: true,
  });
  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function addItem(data: {
  url: string;
  title: string;
  description: string;
  image_url: string;
  source_name: string;
  source_handle: string;
  source_type: string;
  categories: string[];
  channelIds: string[];
  notes?: string;
}): Promise<
  | { success: true; itemId: string }
  | { success: false; error: string }
> {
  if (!supabaseAdmin) {
    return {
      success: false,
      error: "Supabase admin not configured",
    };
  }
  const client = supabaseAdmin;
  const { channelIds, ...rest } = data;

  const itemPayload = {
    ...rest,
    source_type: rest.source_type || detectSourceType(rest.url),
    notes: rest.notes ?? null,
  };

  const { data: inserted, error: itemErr } = await client
    .from("items")
    .insert([itemPayload])
    .select("id")
    .single();

  if (itemErr || !inserted) {
    return {
      success: false,
      error: itemErr?.message ?? "Failed to insert item",
    };
  }
  const itemId = inserted.id as string;

  if (channelIds.length > 0) {
    const r = await connectItemToChannelsInternal(client, itemId, channelIds);
    if (!r.success) {
      return { success: false, error: `Item saved but channels failed: ${r.error}` };
    }
  }

  revalidatePath("/archive");
  revalidatePath("/channels");
  revalidatePath("/graph");
  revalidatePath(`/item/${itemId}`);
  return { success: true, itemId };
}

export async function connectItemToChannels(
  itemId: string,
  channelIds: string[]
): Promise<{ success: true } | { success: false; error: string }> {
  if (!supabaseAdmin) {
    return { success: false, error: "Supabase admin not configured" };
  }
  const r = await connectItemToChannelsInternal(
    supabaseAdmin,
    itemId,
    channelIds
  );
  if (!r.success) return r;
  revalidatePath("/archive");
  revalidatePath("/channels");
  revalidatePath(`/item/${itemId}`);
  return { success: true };
}

export async function disconnectItemFromChannel(
  itemId: string,
  channelId: string
): Promise<{ success: true } | { success: false; error: string }> {
  if (!supabaseAdmin) {
    return { success: false, error: "Supabase admin not configured" };
  }
  const { error } = await supabaseAdmin
    .from("item_channels")
    .delete()
    .eq("item_id", itemId)
    .eq("channel_id", channelId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/archive");
  revalidatePath("/channels");
  revalidatePath(`/item/${itemId}`);
  return { success: true };
}

export async function updateItemChannels(
  itemId: string,
  channelIds: string[]
): Promise<{ success: true } | { success: false; error: string }> {
  if (!supabaseAdmin) {
    return { success: false, error: "Supabase admin not configured" };
  }
  const client = supabaseAdmin;

  const { data: existing, error: selErr } = await client
    .from("item_channels")
    .select("channel_id")
    .eq("item_id", itemId);
  if (selErr) return { success: false, error: selErr.message };

  const currentIds = new Set(
    (existing ?? []).map((r) => r.channel_id as string)
  );
  const targetIds = new Set(channelIds);

  const toRemove = [...currentIds].filter((id) => !targetIds.has(id));
  const toAdd = [...targetIds].filter((id) => !currentIds.has(id));

  if (toRemove.length > 0) {
    const { error: delErr } = await client
      .from("item_channels")
      .delete()
      .eq("item_id", itemId)
      .in("channel_id", toRemove);
    if (delErr) return { success: false, error: delErr.message };
  }

  if (toAdd.length > 0) {
    const r = await connectItemToChannelsInternal(client, itemId, toAdd);
    if (!r.success) return r;
  }

  revalidatePath("/archive");
  revalidatePath("/channels");
  revalidatePath(`/item/${itemId}`);
  revalidatePath("/admin/manage");
  return { success: true };
}

export async function updateItemCategories(
  itemId: string,
  categories: string[]
): Promise<{ success: true } | { success: false; error: string }> {
  if (!supabaseAdmin) {
    return { success: false, error: "Supabase admin not configured" };
  }
  const { error } = await supabaseAdmin
    .from("items")
    .update({ categories })
    .eq("id", itemId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/archive");
  revalidatePath(`/item/${itemId}`);
  revalidatePath("/admin/manage");
  return { success: true };
}

export async function reorderChannelItem(
  channelId: string,
  itemId: string,
  newPosition: number
): Promise<{ success: true } | { success: false; error: string }> {
  if (!supabaseAdmin) {
    return { success: false, error: "Supabase admin not configured" };
  }
  const { error } = await supabaseAdmin
    .from("item_channels")
    .update({ position: newPosition })
    .eq("channel_id", channelId)
    .eq("item_id", itemId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/channels");
  return { success: true };
}

export async function deleteItem(
  id: string
): Promise<{ success: true } | { success: false; error: string }> {
  if (!supabaseAdmin) {
    return { success: false, error: "Supabase admin not configured" };
  }
  const { error } = await supabaseAdmin.from("items").delete().eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/archive");
  revalidatePath("/channels");
  revalidatePath("/graph");
  revalidatePath("/admin/manage");
  return { success: true };
}

export async function bulkDeleteItems(
  ids: string[]
): Promise<
  { success: true; count: number } | { success: false; error: string }
> {
  if (!supabaseAdmin) {
    return { success: false, error: "Supabase admin not configured" };
  }
  if (ids.length === 0) return { success: true, count: 0 };
  const { error, count } = await supabaseAdmin
    .from("items")
    .delete({ count: "exact" })
    .in("id", ids);
  if (error) return { success: false, error: error.message };
  revalidatePath("/archive");
  revalidatePath("/channels");
  revalidatePath("/graph");
  revalidatePath("/admin/manage");
  return { success: true, count: count ?? ids.length };
}

export async function updateItemTagsAndCategories(
  itemId: string,
  tagNames: string[],
  categories: string[]
): Promise<{ success: true } | { success: false; error: string }> {
  if (!supabaseAdmin) {
    return { success: false, error: "Supabase admin not configured" };
  }
  const client = supabaseAdmin;

  const { error: catErr } = await client
    .from("items")
    .update({ categories })
    .eq("id", itemId);
  if (catErr) return { success: false, error: catErr.message };

  const { error: deleteErr } = await client
    .from("item_tags")
    .delete()
    .eq("item_id", itemId);
  if (deleteErr) return { success: false, error: deleteErr.message };

  const tagIds = (
    await Promise.all(tagNames.map((n) => ensureTagId(client, n)))
  ).filter((id): id is string => id !== null);

  if (tagIds.length > 0) {
    const { error: linkErr } = await client
      .from("item_tags")
      .insert(tagIds.map((tag_id) => ({ item_id: itemId, tag_id })));
    if (linkErr) return { success: false, error: linkErr.message };
  }

  revalidatePath("/archive");
  revalidatePath("/graph");
  revalidatePath(`/item/${itemId}`);
  revalidatePath("/admin/manage");
  return { success: true };
}

export async function scrapeMissingMetadata(
  limit: number = 8,
  cursorId?: string
): Promise<
  | {
      success: true;
      scraped: number;
      failed: number;
      lastId: string | null;
      remaining: number;
    }
  | { success: false; error: string }
> {
  if (!supabaseAdmin) {
    return { success: false, error: "Supabase admin not configured" };
  }
  const client = supabaseAdmin;

  let query = client
    .from("items")
    .select("id, url")
    .is("image_url", null)
    .order("id")
    .limit(limit);
  if (cursorId) query = query.gt("id", cursorId);

  const { data: targets, error: selectErr } = await query;
  if (selectErr) return { success: false, error: selectErr.message };
  if (!targets || targets.length === 0) {
    return { success: true, scraped: 0, failed: 0, lastId: null, remaining: 0 };
  }

  const ogs = (await import("open-graph-scraper")).default;
  const PER_ITEM_TIMEOUT_MS = 5000;

  const results = await Promise.allSettled(
    targets.map(async (t) => {
      const id = t.id as string;
      const url = t.url as string;
      try {
        const { result } = (await Promise.race([
          ogs({ url, timeout: PER_ITEM_TIMEOUT_MS }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), PER_ITEM_TIMEOUT_MS)
          ),
        ])) as Awaited<ReturnType<typeof ogs>>;

        const ogImage = Array.isArray(result.ogImage)
          ? result.ogImage[0]?.url
          : (result.ogImage as { url?: string } | undefined)?.url;

        const updates: Record<string, unknown> = {};
        if (result.ogTitle) updates.title = result.ogTitle;
        if (result.ogDescription) updates.description = result.ogDescription;
        if (ogImage && ogImage.startsWith("https://")) {
          updates.image_url = ogImage;
        }
        if (result.ogSiteName) updates.source_name = result.ogSiteName;

        if (!updates.image_url) {
          return { id, scraped: false } as const;
        }

        const { error: updateErr } = await client
          .from("items")
          .update(updates)
          .eq("id", id);
        if (updateErr) {
          return { id, scraped: false } as const;
        }
        return { id, scraped: true } as const;
      } catch {
        return { id, scraped: false } as const;
      }
    })
  );

  let scraped = 0;
  let failed = 0;
  for (const r of results) {
    if (r.status === "fulfilled" && r.value.scraped) scraped++;
    else failed++;
  }

  const lastId = (targets[targets.length - 1] as { id: string }).id;

  const { count } = await client
    .from("items")
    .select("*", { count: "exact", head: true })
    .is("image_url", null)
    .gt("id", lastId);

  if (scraped > 0) {
    revalidatePath("/archive");
    revalidatePath("/admin/manage");
  }

  return {
    success: true,
    scraped,
    failed,
    lastId,
    remaining: count ?? 0,
  };
}

export async function scrapeAndUpdateItem(
  itemId: string,
  url: string
): Promise<
  | { success: true; updated: boolean }
  | { success: false; error: string }
> {
  if (!supabaseAdmin) {
    return { success: false, error: "Supabase admin not configured" };
  }
  try {
    const ogs = (await import("open-graph-scraper")).default;
    const { result } = await ogs({ url });
    const ogImage = Array.isArray(result.ogImage)
      ? result.ogImage[0]?.url
      : (result.ogImage as { url?: string } | undefined)?.url;

    const updates: Record<string, unknown> = {};
    if (result.ogTitle) updates.title = result.ogTitle;
    if (result.ogDescription) updates.description = result.ogDescription;
    if (ogImage) updates.image_url = ogImage;
    if (result.ogSiteName) updates.source_name = result.ogSiteName;

    if (Object.keys(updates).length === 0) {
      return { success: true, updated: false };
    }

    const { error } = await supabaseAdmin
      .from("items")
      .update(updates)
      .eq("id", itemId);
    if (error) return { success: false, error: error.message };

    revalidatePath("/archive");
    revalidatePath(`/item/${itemId}`);
    revalidatePath("/admin/manage");
    return { success: true, updated: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Scrape failed";
    return { success: false, error: message };
  }
}
