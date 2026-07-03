"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-server";
import { isAuthed } from "@/lib/access-server";

type Result = { success: true } | { success: false; error: string };

async function guard(): Promise<Result | null> {
  if (!(await isAuthed())) return { success: false, error: "Not authorized." };
  if (!supabaseAdmin) return { success: false, error: "Supabase admin not configured." };
  return null;
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
