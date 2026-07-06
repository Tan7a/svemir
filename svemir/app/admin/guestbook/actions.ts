"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-server";
import { isAuthed } from "@/lib/access-server";

type Result = { success: true } | { success: false; error: string };

/** A guestbook entry as the admin moderation list needs it (hidden ones too). */
export type AdminEntry = {
  id: string;
  name: string;
  message: string;
  color: string | null;
  sticker: string | null;
  hidden: boolean;
  created_at: string;
};

async function guard(): Promise<Result | null> {
  if (!(await isAuthed())) return { success: false, error: "Not authorized." };
  if (!supabaseAdmin) return { success: false, error: "Supabase admin not configured." };
  return null;
}

/**
 * List every guestbook entry (including hidden ones) for the inline Guestbook
 * tab in the admin overlay, newest first. Guarded; returns { error }.
 */
export async function listGuestbookEntries(): Promise<
  { entries: AdminEntry[] } | { error: string }
> {
  if (!(await isAuthed())) return { error: "Not authorized." };
  if (!supabaseAdmin) return { error: "Supabase admin not configured." };
  const { data, error } = await supabaseAdmin
    .from("guestbook_entries")
    .select("id, name, message, color, sticker, hidden, created_at")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return { error: error.message };
  return { entries: (data ?? []) as AdminEntry[] };
}

/** Hide or un-hide a guestbook entry (soft moderation - keeps the row). */
export async function setGuestbookHidden(
  id: string,
  hidden: boolean
): Promise<Result> {
  const bad = await guard();
  if (bad) return bad;
  const { error } = await supabaseAdmin!
    .from("guestbook_entries")
    .update({ hidden })
    .eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/guestbook");
  revalidatePath("/admin/guestbook");
  return { success: true };
}

/** Permanently delete a guestbook entry. */
export async function deleteGuestbookEntry(id: string): Promise<Result> {
  const bad = await guard();
  if (bad) return bad;
  const { error } = await supabaseAdmin!
    .from("guestbook_entries")
    .delete()
    .eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/guestbook");
  revalidatePath("/admin/guestbook");
  return { success: true };
}
