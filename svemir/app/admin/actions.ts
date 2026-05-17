"use server";

import { supabaseAdmin } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deriveTagsAndCategories,
  detectSourceType,
  type ParsedBookmark,
} from "@/lib/bookmarks-parser";
import { slugify } from "@/lib/constants";

/**
 * Insert-then-lookup pattern for channels. Race-safe at personal scale: if
 * the insert fails on the lower(title) unique index, we ilike-match the
 * existing row.
 */
async function ensureChannelId(
  client: SupabaseClient,
  rawTitle: string
): Promise<string | null> {
  const title = rawTitle.trim();
  if (!title) return null;

  const slug = slugify(title);
  if (!slug) return null;

  const { data: inserted, error: insertErr } = await client
    .from("channels")
    .insert({ title, slug })
    .select("id")
    .single();

  if (!insertErr && inserted) return inserted.id as string;

  const { data: existing } = await client
    .from("channels")
    .select("id")
    .ilike("title", title)
    .maybeSingle();

  return (existing?.id as string | undefined) ?? null;
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
  channelTitles: string[];
}): Promise<{ success: true } | { success: false; error: string }> {
  if (!supabaseAdmin) {
    return {
      success: false,
      error:
        "Supabase admin is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    };
  }

  const client = supabaseAdmin;
  const { channelTitles, ...itemData } = data;

  const { data: inserted, error: itemErr } = await client
    .from("items")
    .insert([{ ...itemData, kind: "link" }])
    .select("id")
    .single();

  if (itemErr || !inserted) {
    return {
      success: false,
      error: itemErr?.message ?? "Failed to insert item",
    };
  }

  const blockId = inserted.id as string;

  const channelIds = (
    await Promise.all(channelTitles.map((n) => ensureChannelId(client, n)))
  ).filter((id): id is string => id !== null);

  if (channelIds.length > 0) {
    const links = channelIds.map((channel_id) => ({
      block_id: blockId,
      channel_id,
    }));
    const { error: linkErr } = await client.from("connections").insert(links);
    if (linkErr) {
      return {
        success: false,
        error: `Item saved but channels failed: ${linkErr.message}`,
      };
    }
  }

  revalidatePath("/");
  revalidatePath("/graph");
  revalidatePath(`/block/${blockId}`);
  return { success: true };
}

export async function bulkImportBookmarks(
  bookmarks: ParsedBookmark[]
): Promise<
  | { success: true; inserted: number; skipped: number }
  | { success: false; error: string }
> {
  if (!supabaseAdmin) {
    return {
      success: false,
      error:
        "Supabase admin is not configured. Set SUPABASE_SERVICE_ROLE_KEY.",
    };
  }
  const client = supabaseAdmin;

  if (bookmarks.length === 0) {
    return { success: true, inserted: 0, skipped: 0 };
  }

  const urls = bookmarks.map((b) => b.url);
  const { data: existing } = await client
    .from("items")
    .select("url")
    .in("url", urls);
  const existingSet = new Set((existing ?? []).map((r) => r.url as string));

  const seenInPayload = new Set<string>();
  const fresh = bookmarks.filter((b) => {
    if (existingSet.has(b.url)) return false;
    if (seenInPayload.has(b.url)) return false;
    seenInPayload.add(b.url);
    return true;
  });

  if (fresh.length === 0) {
    return {
      success: true,
      inserted: 0,
      skipped: bookmarks.length,
    };
  }

  // For each fresh bookmark, derive the list of channel-titles from its
  // folder path. (deriveTagsAndCategories still returns {tags,categories} —
  // we just treat the "tags" as channel titles in this new model.)
  const channelTitlesPerBookmark: string[][] = [];
  const allChannelTitles = new Set<string>();

  const rows = fresh.map((b) => {
    const { tags: channelTitles, categories } = deriveTagsAndCategories(
      b.folderPath
    );
    channelTitlesPerBookmark.push(channelTitles);
    channelTitles.forEach((t) => allChannelTitles.add(t));
    return {
      url: b.url,
      title: b.title,
      description: null,
      image_url: null,
      source_name: null,
      source_handle: null,
      source_type: detectSourceType(b.url),
      categories,
      kind: "link",
    };
  });

  const channelIdByTitle = new Map<string, string>();
  for (const title of allChannelTitles) {
    const id = await ensureChannelId(client, title);
    if (id) channelIdByTitle.set(title, id);
  }

  const CHUNK = 200;
  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += CHUNK) {
    const chunk = rows.slice(offset, offset + CHUNK);
    const channelsChunk = channelTitlesPerBookmark.slice(offset, offset + CHUNK);

    const { data: insertedRows, error } = await client
      .from("items")
      .insert(chunk)
      .select("id, url");

    if (error) {
      return {
        success: false,
        error: `Insert failed at offset ${offset}: ${error.message}`,
      };
    }

    const linkRows: { block_id: string; channel_id: string }[] = [];
    (insertedRows ?? []).forEach((row, i) => {
      const channelsForThis = channelsChunk[i] ?? [];
      channelsForThis.forEach((channelTitle) => {
        const channelId = channelIdByTitle.get(channelTitle);
        if (channelId) {
          linkRows.push({
            block_id: row.id as string,
            channel_id: channelId,
          });
        }
      });
    });

    if (linkRows.length > 0) {
      const { error: linkErr } = await client
        .from("connections")
        .insert(linkRows);
      if (linkErr) {
        return {
          success: false,
          error: `Connection links failed at offset ${offset}: ${linkErr.message}`,
        };
      }
    }

    inserted += insertedRows?.length ?? 0;
  }

  revalidatePath("/");
  revalidatePath("/graph");
  revalidatePath("/admin/manage");

  return {
    success: true,
    inserted,
    skipped: bookmarks.length - inserted,
  };
}

export async function deleteItem(
  id: string
): Promise<{ success: true } | { success: false; error: string }> {
  if (!supabaseAdmin) {
    return { success: false, error: "Supabase admin not configured" };
  }
  const { error } = await supabaseAdmin.from("items").delete().eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/");
  revalidatePath("/graph");
  revalidatePath("/admin/manage");
  return { success: true };
}

export async function bulkDeleteItems(
  ids: string[]
): Promise<{ success: true; count: number } | { success: false; error: string }> {
  if (!supabaseAdmin) {
    return { success: false, error: "Supabase admin not configured" };
  }
  if (ids.length === 0) return { success: true, count: 0 };
  const { error, count } = await supabaseAdmin
    .from("items")
    .delete({ count: "exact" })
    .in("id", ids);
  if (error) return { success: false, error: error.message };
  revalidatePath("/");
  revalidatePath("/graph");
  revalidatePath("/admin/manage");
  return { success: true, count: count ?? ids.length };
}

export async function updateItemChannelsAndCategories(
  blockId: string,
  channelTitles: string[],
  categories: string[]
): Promise<{ success: true } | { success: false; error: string }> {
  if (!supabaseAdmin) {
    return { success: false, error: "Supabase admin not configured" };
  }
  const client = supabaseAdmin;

  const { error: catErr } = await client
    .from("items")
    .update({ categories })
    .eq("id", blockId);
  if (catErr) return { success: false, error: catErr.message };

  const { error: deleteErr } = await client
    .from("connections")
    .delete()
    .eq("block_id", blockId);
  if (deleteErr) return { success: false, error: deleteErr.message };

  const channelIds = (
    await Promise.all(channelTitles.map((n) => ensureChannelId(client, n)))
  ).filter((id): id is string => id !== null);

  if (channelIds.length > 0) {
    const { error: linkErr } = await client
      .from("connections")
      .insert(
        channelIds.map((channel_id) => ({ block_id: blockId, channel_id }))
      );
    if (linkErr) return { success: false, error: linkErr.message };
  }

  revalidatePath("/");
  revalidatePath("/graph");
  revalidatePath(`/block/${blockId}`);
  revalidatePath("/admin/manage");
  return { success: true };
}

export async function scrapeAndUpdateItem(
  blockId: string,
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
      .eq("id", blockId);
    if (error) return { success: false, error: error.message };

    revalidatePath("/");
    revalidatePath(`/block/${blockId}`);
    revalidatePath("/admin/manage");
    return { success: true, updated: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Scrape failed";
    return { success: false, error: message };
  }
}
