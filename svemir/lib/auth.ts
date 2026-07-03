import { createHash } from "node:crypto";
import { supabaseAdmin } from "./supabase-server";

export type AuthResult =
  | { ok: true; tokenId: string }
  | { ok: false; status: 401 | 500; error: string };

/**
 * Verify a `Authorization: Bearer <token>` header against the api_tokens
 * table. Hashes the presented token with sha256 and looks up by hash -
 * plaintexts never touch the DB or logs.
 *
 * Bumps `last_used_at` fire-and-forget. Service-role bypasses RLS on the
 * api_tokens table, so this only works when supabaseAdmin is configured.
 */
export async function requireBearerToken(req: Request): Promise<AuthResult> {
  if (!supabaseAdmin) {
    return {
      ok: false,
      status: 500,
      error: "Supabase admin is not configured on the server.",
    };
  }

  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return { ok: false, status: 401, error: "Missing bearer token." };
  }

  const presented = match[1].trim();
  if (!presented) {
    return { ok: false, status: 401, error: "Empty bearer token." };
  }

  const hash = createHash("sha256").update(presented).digest("hex");

  const { data, error } = await supabaseAdmin
    .from("api_tokens")
    .select("id")
    .eq("token_hash", hash)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, status: 401, error: "Invalid bearer token." };
  }

  const tokenId = data.id as string;
  // Fire-and-forget last_used bump; ignore failures.
  void supabaseAdmin
    .from("api_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", tokenId);

  return { ok: true, tokenId };
}
