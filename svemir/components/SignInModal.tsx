"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { signIn } from "@/lib/access-actions";

type Props = {
  open: boolean;
  onClose: () => void;
};

/**
 * Custom in-app sign-in popup that replaces the browser-native Basic Auth
 * dialog. Checks the SAME admin credentials (ADMIN_USERNAME / ADMIN_PASSWORD)
 * via the signIn server action, which sets the session cookie on success.
 *
 * Closes via the × button, the backdrop, or Escape. Borrows the backdrop +
 * scroll-lock pattern from components/Modal.tsx.
 */
export default function SignInModal({ open, onClose }: Props) {
  const router = useRouter();
  const usernameRef = useRef<HTMLInputElement>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    // Focus the first field once the dialog mounts.
    usernameRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  // Render via a portal to document.body: the TopBar uses backdrop-blur, which
  // makes it a containing block for fixed descendants - without the portal the
  // overlay would be trapped inside the 48px-tall header instead of the viewport.
  if (!open || typeof document === "undefined") return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await signIn(username, password);
    setPending(false);
    if (res.ok) {
      onClose();
      router.push("/admin");
      router.refresh();
    } else {
      setError(res.error);
      setPassword("");
    }
  }

  const inputClass =
    "w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-neutral-500 focus:outline-none";

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Sign in"
        className="relative w-full max-w-sm rounded-xl border border-neutral-800 bg-background p-6 shadow-panel"
        style={{ animation: "dialog-in 0.18s ease-out" }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-xl text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100"
        >
          ×
        </button>

        <h2 className="text-lg font-light text-neutral-100">Sign in to add</h2>
        <p className="mb-5 mt-1 text-xs text-neutral-500">
          Browsing is open to everyone - signing in is only needed to save.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            ref={usernameRef}
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            autoComplete="username"
            className={inputClass}
          />

          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete="current-password"
              className={`${inputClass} pr-14`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-xs text-neutral-400 hover:text-neutral-100"
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={pending}
            className="mt-1 rounded-xl bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-50 disabled:opacity-60"
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>,
    document.body
  );
}
