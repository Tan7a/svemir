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
import {
  reconcileBlockConcepts,
  removeBlockConcepts,
  isPrivateOnly,
} from "@/lib/concepts";
import {
  createBlock,
  resolveExtractionBody,
  syncBlockConceptPrivacy,
  type CreateBlockInput,
} from "@/lib/blocks";
import type { Item, Channel, ItemWithChannels } from "@/lib/types";

/** Page size for the inline Manage list in the admin overlay. */
const MANAGE_PAGE_SIZE = 50;

type ManageItemRow = Item & {
  connections: { channels: unknown }[] | null;
};

function asChannelList(raw: unknown): Channel[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as Channel[];
  return [raw as Channel];
}

/**
 * Paginated item list for the inline Manage tab in the admin overlay. Guarded;
 * returns { error } instead of throwing so the caller can show a muted line.
 */
export async function listItems(input: {
  page?: number;
  q?: string;
}): Promise<
  | { items: ItemWithChannels[]; page: number; totalPages: number }
  | { error: string }
> {
  if (!(await isAuthed())) return { error: "Not authorized." };
  if (!supabaseAdmin) return { error: "Supabase admin not configured." };

  const page = Math.max(1, Number(input.page ?? 1));
  const q = (input.q ?? "").trim();

  let query = supabaseAdmin
    .from("items")
    .select("*, connections(channels(*))", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * MANAGE_PAGE_SIZE, page * MANAGE_PAGE_SIZE - 1);

  if (q) {
    query = query.or(
      `title.ilike.%${q}%,description.ilike.%${q}%,url.ilike.%${q}%`
    );
  }

  const { data, error, count } = await query;
  if (error) return { error: error.message };

  const items: ItemWithChannels[] = (
    (data ?? []) as unknown as ManageItemRow[]
  ).map((row) => {
    const { connections, ...rest } = row;
    const channels = (connections ?? []).flatMap((c) =>
      asChannelList(c.channels)
    );
    return { ...rest, channels, connected_blocks: [] };
  });

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / MANAGE_PAGE_SIZE));
  return { items, page, totalPages };
}

export type AddItemInput = CreateBlockInput;

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
  // The insert itself lives in lib/blocks.ts so the bearer-token route
  // (/api/v1/blocks, used by the extension) can share it WITHOUT inheriting
  // this cookie check, which a cross-origin extension fetch can never pass.
  return createBlock(supabaseAdmin, data);
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
  // folder path. (deriveTagsAndCategories still returns {tags,categories} -
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
 * Rename a block - update its title only. Used by double-clicking the title in
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
 * Update a block's description (for papers, the abstract). Used by the inline
 * editable text in the block detail panel. Empty string clears it to null.
 */
export async function updateBlockDescription(
  blockId: string,
  description: string
): Promise<{ success: true } | { success: false; error: string }> {
  if (!(await isAuthed())) {
    return { success: false, error: "Not authorized." };
  }
  if (!supabaseAdmin) {
    return { success: false, error: "Supabase admin not configured" };
  }
  const trimmed = description.trim();
  const { error } = await supabaseAdmin
    .from("items")
    .update({ description: trimmed || null })
    .eq("id", blockId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/");
  revalidatePath(`/block/${blockId}`);
  revalidatePath("/admin/manage");
  return { success: true };
}

/**
 * Rename a channel - update its title only. The `slug` is intentionally left
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
  // Connecting can flip the block public (private-only -> has a public
  // channel) or keep it private; keep the concept tables in step.
  await syncBlockConceptPrivacy(client, blockId);
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
  // Removing a public channel may leave the block private-only; sync scrubs
  // its concept rows in that case.
  await syncBlockConceptPrivacy(supabaseAdmin, blockId);
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

  // The full channel set just changed; reconcile the block's privacy state.
  await syncBlockConceptPrivacy(client, blockId);

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
 * Backfill: replace old auto-captured screenshots with the page's own og:image.
 * Targets only blocks whose image_url points at our own Supabase "screenshots"
 * bucket (a past capture) AND that have a source url to re-scrape - never
 * external og covers or user-uploaded images. Keyset-paginates by id like
 * scrapeMissingMetadata; the client calls it repeatedly until remaining is 0.
 */
const SCREENSHOT_URL_MATCH = "%/object/public/screenshots/%";

export async function refetchScreenshotCovers(
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
    .like("image_url", SCREENSHOT_URL_MATCH)
    .not("url", "is", null)
    .neq("url", "")
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
        // Only swap when the page offers a usable https image - next/image needs
        // https, and we won't wipe a working cover in exchange for nothing.
        if (!meta.image || !meta.image.startsWith("https://")) {
          return { id, scraped: false } as const;
        }
        const { error: updateErr } = await client
          .from("items")
          .update({ image_url: meta.image })
          .eq("id", id);
        if (updateErr) return { id, scraped: false } as const;
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
    .like("image_url", SCREENSHOT_URL_MATCH)
    .not("url", "is", null)
    .neq("url", "")
    .gt("id", lastId);

  if (scraped > 0) {
    revalidatePath("/");
    revalidatePath("/graph");
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
    .select("id, title, description, body_text, kind, paper_full_text_path")
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
    targets.map(async (t) => {
      // Private-only blocks (migration 0012) must not contribute public
      // concept rows; scrub instead of extracting.
      if (await isPrivateOnly(client, t.id as string)) {
        await removeBlockConcepts(client, t.id as string);
        return 0;
      }
      return reconcileBlockConcepts(client, t.id as string, {
        title: (t.title as string) ?? "",
        description: t.description as string | null,
        body_text: await resolveExtractionBody(
          client,
          t as {
            body_text: string | null;
            kind: string | null;
            paper_full_text_path: string | null;
          }
        ),
      });
    })
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
  channelId: string,
  confirmPublish: boolean = false
): Promise<
  | { success: true }
  | { success: true; needsConfirmation: true; memberCount: number }
  | { success: false; error: string }
> {
  if (!(await isAuthed())) {
    return { success: false, error: "Not authorized." };
  }
  if (!supabaseAdmin) {
    return { success: false, error: "Supabase admin is not configured." };
  }
  // Capture the channel's blocks BEFORE the cascade wipes the connections:
  // deleting a private channel can make its blocks public (or unconnected,
  // which counts as public under migration 0012), and their concept rows must
  // be re-synced afterwards.
  const { data: members } = await supabaseAdmin
    .from("connections")
    .select("block_id")
    .eq("channel_id", channelId);
  const memberCount = members?.length ?? 0;

  // Server-enforced guard: deleting a private channel silently PUBLISHES its
  // blocks (they reappear on /, in search, and in the graph, and their
  // concepts get re-extracted). Enforced here, not in the UI, so no future
  // caller can skip past it. Column may predate migration 0012, so a missing
  // is_private just falls through to the plain delete.
  if (!confirmPublish && memberCount > 0) {
    const { data: row } = await supabaseAdmin
      .from("channels")
      .select("is_private")
      .eq("id", channelId)
      .maybeSingle();
    if ((row as { is_private?: boolean } | null)?.is_private === true) {
      return { success: true, needsConfirmation: true, memberCount };
    }
  }

  const { error } = await supabaseAdmin
    .from("channels")
    .delete()
    .eq("id", channelId);
  if (error) return { success: false, error: error.message };
  // connections cascade-delete via the FK in migration 0001.
  for (const m of members ?? []) {
    await syncBlockConceptPrivacy(supabaseAdmin, m.block_id as string);
    // Visibility may have flipped either way (private channel deleted: block
    // becomes public; public channel deleted: a block also in a private
    // channel becomes hidden). Bust each member's ISR-cached detail page.
    revalidatePath(`/block/${m.block_id}`);
  }
  revalidatePath("/");
  revalidatePath("/graph");
  return { success: true };
}

export async function recentChannelsAction(): Promise<RecentChannel[]> {
  // Server Action IDs ship in the public bundle (FloatingAdd is in the root
  // layout), so this is callable by anyone; service-role bypasses RLS and
  // would leak private channels without the gate. Empty for signed-out.
  if (!(await isAuthed())) return [];
  if (!supabaseAdmin) return [];
  return recentChannels(supabaseAdmin, 20);
}

/**
 * Flip a channel's privacy (migration 0012). Making it private hides the
 * channel, its connections, and its private-only blocks from every anon
 * surface via RLS; this action's job is the app-side bookkeeping: concept
 * rows for every member block, and cache revalidation. Returns the slug so
 * the caller can route the owner to the right page afterwards.
 */
export async function setChannelPrivacy(
  channelId: string,
  isPrivate: boolean
): Promise<
  | { success: true; slug: string; warning?: string }
  | { success: false; error: string }
> {
  if (!(await isAuthed())) {
    return { success: false, error: "Not authorized." };
  }
  if (!supabaseAdmin) {
    return { success: false, error: "Supabase admin not configured" };
  }
  const client = supabaseAdmin;

  const { data: updated, error } = await client
    .from("channels")
    .update({ is_private: isPrivate })
    .eq("id", channelId)
    .select("slug")
    .single();
  if (error || !updated) {
    return {
      success: false,
      error:
        error?.message ??
        "Channel not found (is migration 0012 applied in Supabase?)",
    };
  }

  // Every member block may have changed visibility; sync sequentially
  // (soft-fails per block inside, tallied so misses reach the owner).
  const { data: members } = await client
    .from("connections")
    .select("block_id")
    .eq("channel_id", channelId);
  let syncFailures = 0;
  for (const m of members ?? []) {
    const ok = await syncBlockConceptPrivacy(client, m.block_id as string);
    if (!ok) syncFailures++;
    // Each member's detail page is ISR-cached (revalidate = 60); without this
    // a just-privatised block keeps serving its full body_text for up to a
    // minute to anyone holding the URL.
    revalidatePath(`/block/${m.block_id}`);
  }

  const slug = updated.slug as string;
  revalidatePath("/");
  revalidatePath("/graph");
  revalidatePath("/facets");
  revalidatePath(`/channel/${slug}`);
  if (syncFailures > 0) {
    return {
      success: true,
      slug,
      warning: `Privacy updated, but concept sync failed for ${syncFailures} block${syncFailures === 1 ? "" : "s"}. Run "Re-extract all" in the admin to retry.`,
    };
  }
  return { success: true, slug };
}

/**
 * Owner's full channel list (id, title, slug, is_private), service-role so
 * private channels are included. The anon-key fetch client components used
 * before migration 0012 can no longer see private channels, so owner-facing
 * pickers must come through here. Empty for signed-out callers.
 */
export async function listAllChannelsAction(): Promise<
  { id: string; title: string; slug: string; is_private: boolean }[]
> {
  if (!(await isAuthed())) return [];
  if (!supabaseAdmin) return [];
  const { data, error } = await supabaseAdmin
    .from("channels")
    .select("id, title, slug, is_private")
    .order("title");
  if (!error) {
    return (data ?? []) as {
      id: string;
      title: string;
      slug: string;
      is_private: boolean;
    }[];
  }
  // Migration 0012 not applied yet: the is_private column doesn't exist.
  // Degrade to the plain list rather than an empty picker.
  const { data: plain } = await supabaseAdmin
    .from("channels")
    .select("id, title, slug")
    .order("title");
  return ((plain ?? []) as { id: string; title: string; slug: string }[]).map(
    (c) => ({ ...c, is_private: false })
  );
}

export async function suggestChannelsAction(
  input: SuggestionInput
): Promise<Suggestion[]> {
  // Same exposure as recentChannelsAction: publicly callable action backed by
  // the service-role key, and channel_stats() has no privacy filter.
  if (!(await isAuthed())) return [];
  if (!supabaseAdmin) return [];
  const stats = await channelStats(supabaseAdmin);
  return suggestChannels(input, stats);
}
