"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { HINT_COOKIE } from "@/lib/access";
import SignInModal from "./SignInModal";

/**
 * Invisible sign-in entry. The Add button used to open the sign-in popup when a
 * logged-out visitor deep-linked to /admin (the proxy redirects to "/?signin=1").
 * Now that the top-right is the profile avatar, this keeps that flow alive:
 * auto-opens the sign-in modal on "?signin=1" when not already signed in.
 */
function hasHintCookie(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split("; ").some((c) => c === `${HINT_COOKIE}=1`);
}

export default function SignInGate() {
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (searchParams.get("signin") === "1" && !hasHintCookie()) setOpen(true);
  }, [searchParams]);

  return <SignInModal open={open} onClose={() => setOpen(false)} />;
}
