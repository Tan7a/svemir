"use client";

import { useEffect, useState } from "react";
import { HINT_COOKIE } from "@/lib/access";

/**
 * Reads the readable hint cookie (value "1") to decide whether to show
 * owner-only UI. This is NOT a security boundary - the proxy + the isAuthed()
 * check inside every server action enforce the real httpOnly cookie. It only
 * drives visibility (the floating +, edit/delete/connect controls) so signed-out
 * visitors get a clean read-only view instead of buttons that would just error.
 *
 * Returns false during SSR and the first client render, then flips to the real
 * value after mount (hydration-safe). Auth changes elsewhere navigate + refresh
 * the tree, so a mount-time read stays current.
 */
export function hasHintCookie(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split("; ").some((c) => c === `${HINT_COOKIE}=1`);
}

export function useAuthed(): boolean {
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    // Client-only cookie read: must run after hydration (the server can't see
    // document.cookie), so this deferred setState is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAuthed(hasHintCookie());
  }, []);
  return authed;
}
