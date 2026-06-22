"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { HINT_COOKIE } from "@/lib/access";
import SignInModal from "./SignInModal";

const BUTTON_CLASS =
  "flex items-center gap-1.5 rounded-md border border-neutral-700 px-2.5 py-1 text-xs text-neutral-200 hover:bg-neutral-900";

function hasHintCookie(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie
    .split("; ")
    .some((c) => c === `${HINT_COOKIE}=1`);
}

/**
 * The "Add" control. Browsing is public; saving requires sign-in. Reads the
 * readable hint cookie (NOT a security boundary — the proxy + server actions
 * enforce the real httpOnly cookie) to decide:
 *   - signed in  → a plain link to /admin (keeps prefetch)
 *   - signed out → a button that opens the sign-in popup
 * Also auto-opens the popup when redirected to "/?signin=1" (e.g. a logged-out
 * deep link to /admin).
 */
export default function AddButton() {
  const searchParams = useSearchParams();
  const [authed, setAuthed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setAuthed(hasHintCookie());
  }, []);

  useEffect(() => {
    if (searchParams.get("signin") === "1" && !hasHintCookie()) {
      setOpen(true);
    }
  }, [searchParams]);

  if (authed) {
    return (
      <Link href="/admin" className={BUTTON_CLASS}>
        Add <span className="text-neutral-400">+</span>
      </Link>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BUTTON_CLASS}>
        Add <span className="text-neutral-400">+</span>
      </button>
      <SignInModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
