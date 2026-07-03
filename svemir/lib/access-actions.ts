"use server";

import { cookies } from "next/headers";
import {
  COOKIE_NAME,
  HINT_COOKIE,
  expectedToken,
  verifyCredentials,
} from "./access";

const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/**
 * Validate the submitted credentials against the configured admin and, on
 * success, set the session cookies. Reuses ADMIN_USERNAME / ADMIN_PASSWORD -
 * the password is unchanged from the old Basic Auth gate.
 */
export async function signIn(
  username: string,
  password: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ok = await verifyCredentials(username.trim(), password);
  if (!ok) return { ok: false, error: "Incorrect username or password." };

  const token = await expectedToken();
  if (!token) return { ok: false, error: "Login is not configured." };

  const store = await cookies();
  const secure = process.env.NODE_ENV === "production";
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
  // Readable hint so the Add button knows to navigate instead of prompting.
  store.set(HINT_COOKIE, "1", {
    httpOnly: false,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
  return { ok: true };
}

/** Clear both session cookies. */
export async function signOut(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
  store.delete(HINT_COOKIE);
}
