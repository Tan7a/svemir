"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type Props = {
  children: React.ReactNode;
};

/**
 * Centered popup for intercepted detail routes (block / paper / facet). A clean,
 * rounded card floating over a dimmed, blurred page - same calm, centered feel
 * as the composer. Sizes to its content up to 88vh, then scrolls inside. Closes
 * via: clicking the backdrop, the × button, or Escape.
 *
 * All three call router.back(), which the Next.js parallel-routes pattern for
 * modals uses to unwind the intercepted segment and reveal the underlying view.
 */
export default function Modal({ children }: Props) {
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.back();
    };
    // Lock scroll while the popup is open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [router]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      {/* Backdrop - dims the page behind the popup. A light blur keeps opening
          snappy; a heavy blur repaints the whole page and stutters on open. */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={() => router.back()}
      />

      {/* Popup - centered rounded card, content-sized up to 88vh then scrolls. */}
      <div
        className="relative flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-neutral-800 bg-background shadow-2xl shadow-black/60"
        style={{ animation: "dialog-in 0.12s ease-out" }}
      >
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-900 hover:text-neutral-100"
        >
          ×
        </button>
        <div className="min-h-0 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
