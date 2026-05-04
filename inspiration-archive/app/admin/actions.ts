"use server";

import { supabaseAdmin } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deriveTagsAndCategories,
  detectSourceType,
  type ParsedBookmark,
} from "@/lib/bookmarks-parser";

async function ensureTagId(
  client: SupabaseClient,
  rawName: string
): Promise<string | null> {
  const name = rawName.trim();
  if (!name) return null;

  const { data: inserted, error: insertErr } = await client
    .from("tags")
    .insert({ name })
    .select("id")
    .single();

  if (!insertErr && inserted) return inserted.id;

  const { data: existing } = await client
    .from("tags")
    .select("id")
    .ilike("name", name)
    .maybeSingle();

  return existing?.id ?? null;
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
  tagNames: string[];
}): Promise<{ success: true } | { success: false; error: string }> {
  if (!supabaseAdmin) {
    return {
      success: false,
      error:
        "Supabase admin is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    };
  }

  const client = supabaseAdmin;
  const { tagNames, ...itemData } = data;

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

  const itemId = inserted.id as string;

  const tagIds = (
    await Promise.all(tagNames.map((n) => ensureTagId(client, n)))
  ).filter((id): id is string => id !== null);

  if (tagIds.length > 0) {
    const links = tagIds.map((tag_id) => ({ item_id: itemId, tag_id }));
    const { error: linkErr } = await client.from("item_tags").insert(links);
    if (linkErr) {
      return {
        success: false,
        error: `Item saved but tags failed: ${linkErr.message}`,
      };
    }
  }

  revalidatePath("/archive");
  revalidatePath("/graph");
  revalidatePath(`/item/${itemId}`);
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

  const tagNamePerBookmark: string[][] = [];
  const allTagNames = new Set<string>();

  const rows = fresh.map((b) => {
    const { tags, categories } = deriveTagsAndCategories(b.folderPath);
    tagNamePerBookmark.push(tags);
    tags.forEach((t) => allTagNames.add(t));
    return {
      url: b.url,
      title: b.title,
      description: null,
      image_url: null,
      source_name: null,
      source_handle: null,
      source_type: detectSourceType(b.url),
      categories,
    };
  });

  const tagIdByName = new Map<string, string>();
  for (const name of allTagNames) {
    const id = await ensureTagId(client, name);
    if (id) tagIdByName.set(name, id);
  }

  const CHUNK = 200;
  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += CHUNK) {
    const chunk = rows.slice(offset, offset + CHUNK);
    const tagsChunk = tagNamePerBookmark.slice(offset, offset + CHUNK);

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

    const linkRows: { item_id: string; tag_id: string }[] = [];
    (insertedRows ?? []).forEach((row, i) => {
      const tagsForThis = tagsChunk[i] ?? [];
      tagsForThis.forEach((tagName) => {
        const tagId = tagIdByName.get(tagName);
        if (tagId) {
          linkRows.push({ item_id: row.id as string, tag_id: tagId });
        }
      });
    });

    if (linkRows.length > 0) {
      const { error: linkErr } = await client
        .from("item_tags")
        .insert(linkRows);
      if (linkErr) {
        return {
          success: false,
          error: `Tag links failed at offset ${offset}: ${linkErr.message}`,
        };
      }
    }

    inserted += insertedRows?.length ?? 0;
  }

  revalidatePath("/archive");
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
  revalidatePath("/archive");
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
  revalidatePath("/archive");
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
