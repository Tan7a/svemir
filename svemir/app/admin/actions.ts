"use server";

import { supabaseAdmin } from "@/lib/supabase-server";
import { isAuthed } from "@/lib/access-server";
import { revalidatePath } from "next/cache";
import {
  deriveTagsAndCategories,
  detectSourceType,
  type ParsedBookmark,
} from "@/lib/bookmarks-parser";
import { scrapeOpenGraph } from "@/lib/scrape";
import {
  ensureChannelId,
  recentChannels,
  channelStats,
  type RecentChannel,
} from "@/lib/channels";
import {
  suggestChannels,
  type Suggestion,
  type SuggestionInput,
} from "@/lib/suggest";
import { reconcileBlockConcepts } from "@/lib/concepts";

export type AddItemInput = {
  kind: "link" | "image" | "text";
  url: string;
  title: string;
  description: string;
  image_url: string;
  source_name: string;
  source_handle: string;
  source_type: string;
  categories: string[];
  channelTitles: string[];
  body_text?: string;
};

export async function addItem(
  data: AddItemInput
): Promise<
  | { success: true; id: string }
  | { success: false; error: string }
> {
  if (!(await isAuthed())) {
    return { success: false, error: "Not authorized." };
  }
  if (!supabaseAdmin) {
    return {
      success: false,
      error:
        "Supabase admin is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    };
  }

  const client = supabaseAdmin;
  const { channelTitles, kind, body_text, ...rest } = data;

  // body_text is omitted from the insert when empty so callers (and the
  // /api/v1/blocks bearer-token route used by the Chrome extension) don't
  // trip Supabase's schema cache when the optional 0005 migration hasn't
  // been applied yet. When present it's stored as the page's reader text.
  const cleanBodyText = body_text?.trim();
  const itemData = {
    ...rest,
    kind,
    url: kind === "link" ? rest.url : rest.url || null,
    source_type:
      rest.source_type?.trim() ||
      (kind === "link" && rest.url ? detectSourceType(rest.url) : "website"),
    ...(cleanBodyText ? { body_text: cleanBodyText } : {}),
  };

  const { data: inserted, error: itemErr } = await client
    .from("items")
    .insert([itemData])
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

  // Extract concepts from the block's text. Done synchronously (a serverless
  // function may be frozen after it returns, so "fire-and-forget" is unsafe),
  // but soft-failed: a concept hiccup must never lose the user's save. Skipped
  // silently if migration 0006 hasn't been applied yet.
  try {
    await reconcileBlockConcepts(client, blockId, {
      title: data.title,
      description: data.description,
      body_text: cleanBodyText ?? null,
    });
  } catch {
    // non-fatal — the block is saved; concepts can be backfilled later
  }

  revalidatePath("/");
  revalidatePath("/graph");
  revalidatePath("/concepts");
  revalidatePath(`/block/${blockId}`);
  return { success: true, id: blockId };
}

export async function bulkImportBookmarks(
  bookmarks: ParsedBookmark[]
): Promise<
  | { success: true; inserted: number; skipped: number }
  | { success: false; error: string }
> {
  if (!(await isAuthed())) {
    return { success: false, error: "Not authorized." };
  }
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
  if (!(await isAuthed())) {
    return { success: false, error: "Not authorized." };
  }
  if (!supabaseAdmin) {
    return { success: false, error: "Supabase admin not configured" };
  }
  const { error } = await supabaseAdmin.from("items").delete().eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/");
  revalidatePath("/graph");
  revalidatePath("/concepts");
  revalidatePath("/admin/manage");
  return { success: true };
}

export async function bulkDeleteItems(
  ids: string[]
): Promise<{ success: true; count: number } | { success: false; error: string }> {
  if (!(await isAuthed())) {
    return { success: false, error: "Not authorized." };
  }
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
  revalidatePath("/concepts");
  revalidatePath("/admin/manage");
  return { success: true, count: count ?? ids.length };
}

/**
 * Nest one channel inside another. The child gets the parent's id assigned to
 * its `parent_id` column. Resolves the parent by title (creating it if needed).
 * Used by the "Connect to channel" action in the channel card "…" menu.
 */
export async function setChannelParent(
  childId: string,
  parentTitle: string
): Promise<{ success: true } | { success: false; error: string }> {
  if (!(await isAuthed())) {
    return { success: false, error: "Not authorized." };
  }
  if (!supabaseAdmin) {
    return { success: false, error: "Supabase admin not configured" };
  }
  const client = supabaseAdmin;
  const parentId = await ensureChannelId(client, parentTitle);
  if (!parentId) {
    return { success: false, error: "Could not resolve or create parent channel" };
  }
  if (parentId === childId) {
    return { success: false, error: "A channel cannot be nested inside itself." };
  }
  const { error } = await client
    .from("channels")
    .update({ parent_id: parentId })
    .eq("id", childId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/");
  revalidatePath("/graph");
  return { success: true };
}

/**
 * Detach a channel from its parent. Used by the "Remove from parent" action.
 */
export async function removeChannelParent(
  childId: string
): Promise<{ success: true } | { success: false; error: string }> {
  if (!(await isAuthed())) {
    return { success: false, error: "Not authorized." };
  }
  if (!supabaseAdmin) {
    return { success: false, error: "Supabase admin not configured" };
  }
  const { error } = await supabaseAdmin
    .from("channels")
    .update({ parent_id: null })
    .eq("id", childId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/");
  return { success: true };
}

/**
 * Update the image_url of an existing block. Called by the "Change image"
 * action in the block detail menu after the client has uploaded a file
 * via /api/upload-image and received back a URL.
 */
export async function updateBlockImage(
  blockId: string,
  imageUrl: string
): Promise<{ success: true } | { success: false; error: string }> {
  if (!(await isAuthed())) {
    return { success: false, error: "Not authorized." };
  }
  if (!supabaseAdmin) {
    return { success: false, error: "Supabase admin not configured" };
  }
  const trimmed = imageUrl.trim();
  if (!trimmed) {
    return { success: false, error: "Image URL is required." };
  }
  const { error } = await supabaseAdmin
    .from("items")
    .update({ image_url: trimmed })
    .eq("id", blockId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/");
  revalidatePath(`/block/${blockId}`);
  revalidatePath("/admin/manage");
  return { success: true };
}

/**
 * Rename a block — update its title only. Used by double-clicking the title in
 * the block detail panel.
 */
export async function renameBlock(
  blockId: string,
  title: string
): Promise<{ success: true } | { success: false; error: string }> {
  if (!(await isAuthed())) {
    return { success: false, error: "Not authorized." };
  }
  if (!supabaseAdmin) {
    return { success: false, error: "Supabase admin not configured" };
  }
  const trimmed = title.trim();
  if (!trimmed) {
    return { success: false, error: "Title can't be empty." };
  }
  const { error } = await supabaseAdmin
    .from("items")
    .update({ title: trimmed })
    .eq("id", blockId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/");
  revalidatePath("/graph");
  revalidatePath(`/block/${blockId}`);
  revalidatePath("/admin/manage");
  return { success: true };
}

/**
 * Rename a channel — update its title only. The `slug` is intentionally left
 * unchanged so existing /channel/[slug] links keep resolving. Used by the
 * "Rename" action in the channel "⋯" menu and by double-clicking a channel name.
 */
export async function renameChannel(
  channelId: string,
  title: string
): Promise<{ success: true } | { success: false; error: string }> {
  if (!(await isAuthed())) {
    return { success: false, error: "Not authorized." };
  }
  if (!supabaseAdmin) {
    return { success: false, error: "Supabase admin not configured" };
  }
  const trimmed = title.trim();
  if (!trimmed) {
    return { success: false, error: "Title can't be empty." };
  }
  const { data, error } = await supabaseAdmin
    .from("channels")
    .update({ title: trimmed })
    .eq("id", channelId)
    .select("slug")
    .single();
  if (error) return { success: false, error: error.message };
  revalidatePath("/");
  revalidatePath("/graph");
  if (data?.slug) revalidatePath(`/channel/${data.slug}`);
  return { success: true };
}

/**
 * Append a single channel to an existing block. Resolves the channel by title
 * (creating it if missing), then upserts the (block_id, channel_id) connection.
 * Used by the inline Connect button on the block detail modal.
 */
export async function addChannelToBlock(
  blockId: string,
  channelTitle: string
): Promise<{ success: true } | { success: false; error: string }> {
  if (!(await isAuthed())) {
    return { success: false, error: "Not authorized." };
  }
  if (!supabaseAdmin) {
    return { success: false, error: "Supabase admin not configured" };
  }
  const client = supabaseAdmin;
  const channelId = await ensureChannelId(client, channelTitle);
  if (!channelId) {
    return { success: false, error: "Could not resolve or create channel" };
  }
  const { error } = await client
    .from("connections")
    .upsert(
      { block_id: blockId, channel_id: channelId },
      { onConflict: "block_id,channel_id" }
    );
  if (error) return { success: false, error: error.message };
  revalidatePath("/");
  revalidatePath("/graph");
  revalidatePath(`/block/${blockId}`);
  return { success: true };
}

/**
 * Remove a single channel from a block. Used by the × on each channel chip
 * in the block detail's "Your connections" list.
 */
export async function removeChannelFromBlock(
  blockId: string,
  channelId: string
): Promise<{ success: true } | { success: false; error: string }> {
  if (!(await isAuthed())) {
    return { success: false, error: "Not authorized." };
  }
  if (!supabaseAdmin) {
    return { success: false, error: "Supabase admin not configured" };
  }
  const { error } = await supabaseAdmin
    .from("connections")
    .delete()
    .eq("block_id", blockId)
    .eq("channel_id", channelId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/");
  revalidatePath("/graph");
  revalidatePath(`/block/${blockId}`);
  return { success: true };
}

export async function updateItemChannelsAndCategories(
  blockId: string,
  channelTitles: string[],
  categories: string[]
): Promise<{ success: true } | { success: false; error: string }> {
  if (!(await isAuthed())) {
    return { success: false, error: "Not authorized." };
  }
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
  if (!(await isAuthed())) {
    return { success: false, error: "Not authorized." };
  }
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

  const results = await Promise.allSettled(
    targets.map(async (t) => {
      const id = t.id as string;
      const url = t.url as string;
      try {
        const meta = await scrapeOpenGraph(url);

        const updates: Record<string, unknown> = {};
        if (meta.title) updates.title = meta.title;
        if (meta.description) updates.description = meta.description;
        if (meta.image && meta.image.startsWith("https://")) {
          updates.image_url = meta.image;
        }
        if (meta.siteName) updates.source_name = meta.siteName;

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
    revalidatePath("/");
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

/**
 * Batch concept extraction for blocks that haven't been indexed yet. Pages
 * through `items where concepts_indexed_at is null` by id (keyset pagination),
 * mirroring scrapeMissingMetadata. The client calls this repeatedly, advancing
 * the cursor, until `remaining` hits 0. Prevalence counts are recomputed once,
 * on the final batch.
 */
export async function backfillBlockConcepts(
  limit: number = 10,
  cursorId?: string,
  force: boolean = false
): Promise<
  | {
      success: true;
      processed: number;
      failed: number;
      lastId: string | null;
      remaining: number;
    }
  | { success: false; error: string }
> {
  if (!(await isAuthed())) {
    return { success: false, error: "Not authorized." };
  }
  if (!supabaseAdmin) {
    return { success: false, error: "Supabase admin not configured" };
  }
  const client = supabaseAdmin;

  // Default: only blocks not yet indexed. force=true re-extracts every block
  // (used after tuning stopwords/extraction so existing concepts get rebuilt).
  let query = client
    .from("items")
    .select("id, title, description, body_text")
    .order("id")
    .limit(limit);
  if (!force) query = query.is("concepts_indexed_at", null);
  if (cursorId) query = query.gt("id", cursorId);

  const { data: targets, error: selectErr } = await query;
  if (selectErr) return { success: false, error: selectErr.message };
  if (!targets || targets.length === 0) {
    return { success: true, processed: 0, failed: 0, lastId: null, remaining: 0 };
  }

  // reconcileBlockConcepts refreshes prevalence counts per block, so no separate
  // recompute step is needed.
  const results = await Promise.allSettled(
    targets.map((t) =>
      reconcileBlockConcepts(client, t.id as string, {
        title: (t.title as string) ?? "",
        description: t.description as string | null,
        body_text: t.body_text as string | null,
      })
    )
  );

  let processed = 0;
  let failed = 0;
  for (const r of results) {
    if (r.status === "fulfilled") processed++;
    else failed++;
  }

  const lastId = (targets[targets.length - 1] as { id: string }).id;

  let countQuery = client
    .from("items")
    .select("*", { count: "exact", head: true })
    .gt("id", lastId);
  if (!force) countQuery = countQuery.is("concepts_indexed_at", null);
  const { count } = await countQuery;
  const remaining = count ?? 0;

  revalidatePath("/concepts");
  revalidatePath("/graph");
  revalidatePath("/admin/manage");

  return { success: true, processed, failed, lastId, remaining };
}

export async function scrapeAndUpdateItem(
  blockId: string,
  url: string
): Promise<
  | { success: true; updated: boolean }
  | { success: false; error: string }
> {
  if (!(await isAuthed())) {
    return { success: false, error: "Not authorized." };
  }
  if (!supabaseAdmin) {
    return { success: false, error: "Supabase admin not configured" };
  }
  try {
    const meta = await scrapeOpenGraph(url);

    const updates: Record<string, unknown> = {};
    if (meta.title) updates.title = meta.title;
    if (meta.description) updates.description = meta.description;
    if (meta.image) updates.image_url = meta.image;
    if (meta.siteName) updates.source_name = meta.siteName;

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

/**
 * Manual curatorial edge between two blocks. Persisted in `block_connections`
 * with a canonical `a_id < b_id` ordering (enforced by the table's CHECK).
 * Used by the Connected-blocks picker in the block detail sidebar; the
 * knowledge graph renders these as always-on edges, independent of the
 * channel-overlap heuristic.
 */
export async function connectBlocks(
  aId: string,
  bId: string
): Promise<{ success: true } | { success: false; error: string }> {
  if (!(await isAuthed())) {
    return { success: false, error: "Not authorized." };
  }
  if (!supabaseAdmin) {
    return { success: false, error: "Supabase admin not configured" };
  }
  if (aId === bId) {
    return { success: false, error: "A block can't be connected to itself." };
  }
  const [a, b] = aId < bId ? [aId, bId] : [bId, aId];
  const { error } = await supabaseAdmin
    .from("block_connections")
    .upsert({ a_id: a, b_id: b }, { onConflict: "a_id,b_id" });
  if (error) return { success: false, error: error.message };
  revalidatePath("/graph");
  revalidatePath(`/block/${aId}`);
  revalidatePath(`/block/${bId}`);
  return { success: true };
}

export async function disconnectBlocks(
  aId: string,
  bId: string
): Promise<{ success: true } | { success: false; error: string }> {
  if (!(await isAuthed())) {
    return { success: false, error: "Not authorized." };
  }
  if (!supabaseAdmin) {
    return { success: false, error: "Supabase admin not configured" };
  }
  const [a, b] = aId < bId ? [aId, bId] : [bId, aId];
  const { error } = await supabaseAdmin
    .from("block_connections")
    .delete()
    .eq("a_id", a)
    .eq("b_id", b);
  if (error) return { success: false, error: error.message };
  revalidatePath("/graph");
  revalidatePath(`/block/${aId}`);
  revalidatePath(`/block/${bId}`);
  return { success: true };
}

export async function deleteChannel(
  channelId: string
): Promise<{ success: true } | { success: false; error: string }> {
  if (!(await isAuthed())) {
    return { success: false, error: "Not authorized." };
  }
  if (!supabaseAdmin) {
    return { success: false, error: "Supabase admin is not configured." };
  }
  const { error } = await supabaseAdmin
    .from("channels")
    .delete()
    .eq("id", channelId);
  if (error) return { success: false, error: error.message };
  // connections cascade-delete via the FK in migration 0001.
  revalidatePath("/");
  revalidatePath("/graph");
  return { success: true };
}

export async function recentChannelsAction(): Promise<RecentChannel[]> {
  if (!supabaseAdmin) return [];
  return recentChannels(supabaseAdmin, 20);
}

export async function suggestChannelsAction(
  input: SuggestionInput
): Promise<Suggestion[]> {
  if (!supabaseAdmin) return [];
  const stats = await channelStats(supabaseAdmin);
  return suggestChannels(input, stats);
}
