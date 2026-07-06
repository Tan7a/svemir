"use server";

import { randomBytes, createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-server";
import { isAuthed } from "@/lib/access-server";

/** Row shape returned to the client (never includes the token hash). */
export type TokenRow = {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
};

/**
 * List every personal access token (metadata only). Used by the inline admin
 * overlay to render the Tokens tab without a full server-component page load.
 * Guarded like every other action here; returns { error } instead of throwing
 * so the caller can show a muted error line.
 */
export async function listTokens(): Promise<
  { tokens: TokenRow[] } | { error: string }
> {
  if (!(await isAuthed())) {
    return { error: "Not authorized." };
  }
  if (!supabaseAdmin) {
    return { error: "Supabase admin not configured." };
  }
  const { data, error } = await supabaseAdmin
    .from("api_tokens")
    .select("id, name, created_at, last_used_at")
    .order("created_at", { ascending: false });
  if (error) return { error: error.message };
  return { tokens: (data ?? []) as TokenRow[] };
}

/**
 * Mint a fresh personal access token. Plaintext is returned to the caller
 * **exactly once** and never persisted - only its sha256 hash is stored.
 * The caller (a client component) must surface it to the user in a banner
 * and not re-render it after the next round-trip.
 */
export async function createToken(
  name: string
): Promise<
  | { success: true; id: string; token: string }
  | { success: false; error: string }
> {
  if (!(await isAuthed())) {
    return { success: false, error: "Not authorized." };
  }
  if (!supabaseAdmin) {
    return { success: false, error: "Supabase admin not configured." };
  }
  const trimmed = name.trim();
  if (!trimmed) {
    return { success: false, error: "Name is required." };
  }

  const token = randomBytes(32).toString("hex");
  const token_hash = createHash("sha256").update(token).digest("hex");

  const { data, error } = await supabaseAdmin
    .from("api_tokens")
    .insert({ name: trimmed, token_hash })
    .select("id")
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? "Insert failed." };
  }

  revalidatePath("/admin/tokens");
  return { success: true, id: data.id as string, token };
}

export async function revokeToken(
  id: string
): Promise<{ success: true } | { success: false; error: string }> {
  if (!(await isAuthed())) {
    return { success: false, error: "Not authorized." };
  }
  if (!supabaseAdmin) {
    return { success: false, error: "Supabase admin not configured." };
  }
  const { error } = await supabaseAdmin.from("api_tokens").delete().eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/tokens");
  return { success: true };
}
