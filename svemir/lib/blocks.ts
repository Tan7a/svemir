import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureChannelId } from "./channels";
import { detectSourceType } from "./bookmarks-parser";
import {
  isPrivateOnly,
  removeBlockConcepts,
  reconcileBlockConcepts,
} from "./concepts";
import { cleanPaperMarkdown, PAPERS_BUCKET } from "./paper-text";

// Block creation + concept-privacy bookkeeping, shared by two differently
// authenticated front doors:
//   - addItem in app/admin/actions.ts (cookie session via isAuthed())
//   - POST /api/v1/blocks (bearer token, used by the Chrome extension)
// The extension can never present the httpOnly session cookie (its fetch is
// cross-origin), so the route must not funnel through the cookie-gated server
// action. Each caller does its own auth and passes the service-role client in.
// Nothing here checks auth - never import this from a public code path.

export type CreateBlockInput = {
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

/**
 * The text concept extraction should read for an item row. Papers keep their
 * full text in the private bucket (copyright gate), so their body_text is
 * empty; download and clean it transiently, never persisting it. Falls back to
 * whatever body_text the row carries (or null) on any download hiccup.
 */
export async function resolveExtractionBody(
  client: SupabaseClient,
  row: {
    body_text: string | null;
    kind: string | null;
    paper_full_text_path: string | null;
  }
): Promise<string | null> {
  if (row.kind !== "paper" || row.body_text || !row.paper_full_text_path) {
    return row.body_text;
  }
  try {
    const { data: blob } = await client.storage
      .from(PAPERS_BUCKET)
      .download(row.paper_full_text_path);
    if (blob) return cleanPaperMarkdown(await blob.text());
  } catch {
    /* soft-fail: extract from title + abstract */
  }
  return row.body_text;
}

/**
 * Keep a block's public concept rows consistent with its privacy state
 * (migration 0012): private-only blocks must have NO block_concepts rows
 * (those tables are select-using(true), so rows would leak the block's
 * vocabulary); public blocks that were previously scrubbed get re-extracted.
 * Call after anything that changes which channels a block belongs to.
 * Soft-fails (privacy bookkeeping must never break the user's action) but
 * returns false on failure so callers can count and surface misses instead of
 * silently leaving a private block's concepts public.
 */
export async function syncBlockConceptPrivacy(
  client: SupabaseClient,
  blockId: string
): Promise<boolean> {
  try {
    if (await isPrivateOnly(client, blockId)) {
      await removeBlockConcepts(client, blockId);
      return true;
    }
    // Publicly visible. Re-extract only when the block has no concept rows
    // (fresh block, or previously scrubbed while private).
    const { count } = await client
      .from("block_concepts")
      .select("*", { count: "exact", head: true })
      .eq("block_id", blockId);
    if ((count ?? 0) > 0) return true;
    const { data: row } = await client
      .from("items")
      .select("id, title, description, body_text, kind, paper_full_text_path")
      .eq("id", blockId)
      .maybeSingle();
    if (!row) return true;
    await reconcileBlockConcepts(client, blockId, {
      title: (row.title as string) ?? "",
      description: row.description as string | null,
      body_text: await resolveExtractionBody(
        client,
        row as {
          body_text: string | null;
          kind: string | null;
          paper_full_text_path: string | null;
        }
      ),
    });
    return true;
  } catch (err) {
    // Non-fatal for the caller's action, but never invisible: a miss here can
    // leave a private block's vocabulary in the public concept tables.
    console.error(`syncBlockConceptPrivacy(${blockId}) failed:`, err);
    return false;
  }
}

/**
 * Insert a block, connect it to its channels (creating them as needed), sync
 * concept privacy, and bust the affected caches. The caller has already
 * authenticated and passes the service-role client.
 */
export async function createBlock(
  client: SupabaseClient,
  data: CreateBlockInput
): Promise<
  { success: true; id: string } | { success: false; error: string }
> {
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

  // Extract concepts from the block's text - unless every target channel is
  // private, in which case the block must stay out of the public concept
  // tables (sync handles both cases). Done synchronously (a serverless
  // function may be frozen after it returns, so "fire-and-forget" is unsafe),
  // and soft-failed inside sync: a concept hiccup must never lose the save.
  await syncBlockConceptPrivacy(client, blockId);

  revalidatePath("/");
  revalidatePath("/graph");
  revalidatePath(`/block/${blockId}`);
  return { success: true, id: blockId };
}
