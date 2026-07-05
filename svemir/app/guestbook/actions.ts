"use server";

import { createHash } from "crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-server";
import {
  GUESTBOOK_COLORS,
  GUESTBOOK_STICKERS,
  GUESTBOOK_STYLES,
  DEFAULT_COLOR,
  DEFAULT_STYLE,
} from "@/lib/guestbook";

export type SignGuestbookInput = {
  name: string;
  message: string;
  color: string;
  style: string;
  sticker: string;
  /** Honeypot - must stay empty; bots tend to fill every field. */
  website?: string;
};

export type SignGuestbookResult =
  | { success: true }
  | { success: false; error: string };

const RATE_WINDOW_SECONDS = 60;

/** Hash the caller's IP so we can rate-limit without storing a raw address. */
async function callerIpHash(): Promise<string | null> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0]?.trim() || h.get("x-real-ip") || "";
  if (!ip) return null;
  return createHash("sha256").update(`guestbook:${ip}`).digest("hex");
}

/**
 * Sign the public guestbook. Anonymous, auto-publishing, but validated and
 * rate-limited server-side (honeypot + one post / minute / IP). Writes with the
 * service-role client since there is no public INSERT policy on the table.
 */
export async function signGuestbook(
  data: SignGuestbookInput
): Promise<SignGuestbookResult> {
  // Honeypot: a filled hidden field means a bot - silently succeed so it
  // doesn't learn to adapt, but write nothing.
  if (data.website && data.website.trim() !== "") {
    return { success: true };
  }

  if (!supabaseAdmin) {
    return { success: false, error: "Guestbook is not configured right now." };
  }

  // Name is optional; message just can't be empty. No length caps.
  const name = (data.name?.trim() ?? "").slice(0, 200) || "Anonymous";
  const message = data.message?.trim() ?? "";
  if (message.length < 1) {
    return { success: false, error: "Please write a message before signing." };
  }
  // Link-spam guard - a couple of links is fine, a wall of them isn't.
  const linkCount = (message.match(/https?:\/\//gi) ?? []).length;
  if (linkCount > 5) {
    return { success: false, error: "Too many links in the message." };
  }

  // Validate personalisation against the known vocabulary; fall back quietly.
  const color = GUESTBOOK_COLORS.some((c) => c.key === data.color)
    ? data.color
    : DEFAULT_COLOR;
  const style = GUESTBOOK_STYLES.some((s) => s.key === data.style)
    ? data.style
    : DEFAULT_STYLE;
  const sticker = GUESTBOOK_STICKERS.includes(data.sticker) ? data.sticker : null;

  // Rate-limit: one post per minute per IP.
  const ipHash = await callerIpHash();
  if (ipHash) {
    const since = new Date(Date.now() - RATE_WINDOW_SECONDS * 1000).toISOString();
    const { count } = await supabaseAdmin
      .from("guestbook_entries")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", since);
    if ((count ?? 0) > 0) {
      return {
        success: false,
        error: "You just signed - give it a minute before posting again.",
      };
    }
  }

  const { error } = await supabaseAdmin
    .from("guestbook_entries")
    .insert([{ name, message, color, style, sticker, ip_hash: ipHash }]);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/guestbook");
  return { success: true };
}
