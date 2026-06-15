"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type Props = {
  children: React.ReactNode;
};

/**
 * Right-side panel for intercepted block routes. Replaces the old centered
 * popup with a 600px-wide panel anchored to the right edge. Closes via:
 *   - clicking the backdrop
 *   - clicking the × button
 *   - pressing Escape
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
    // Lock scroll while the panel is open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [router]);

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop — dims the page behind the panel. */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => router.back()}
      />

      {/* Panel — fixed 600px on the right, full height, scrolls internally. */}
      <div
        className="absolute inset-y-0 right-0 flex w-full max-w-[600px] flex-col border-l border-neutral-800 bg-background shadow-2xl shadow-black/60"
        style={{ animation: "panel-in 0.2s ease-out" }}
      >
        <div className="flex shrink-0 items-center justify-end border-b border-neutral-800 px-4 py-2.5">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
