"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type Props = {
  children: React.ReactNode;
};

/**
 * Modal wrapper for intercepted routes. Closes via:
 *   - clicking the backdrop
 *   - clicking the × button
 *   - pressing Escape
 *
 * All three call router.back(), which the Next.js parallel-routes pattern
 * for modals uses to unwind the intercepted segment and reveal the
 * underlying view (the IA we designed in the plan).
 */
export default function Modal({ children }: Props) {
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.back();
    };
    // Lock scroll while modal is open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [router]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/85 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) router.back();
      }}
    >
      <div className="relative w-full max-w-6xl">
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
          <button
            type="button"
            disabled
            aria-label="Previous block"
            className="flex h-7 w-7 items-center justify-center text-neutral-500 disabled:cursor-not-allowed"
            title="Coming in Phase C"
          >
            ←
          </button>
          <button
            type="button"
            disabled
            aria-label="Next block"
            className="flex h-7 w-7 items-center justify-center text-neutral-500 disabled:cursor-not-allowed"
            title="Coming in Phase C"
          >
            →
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center text-neutral-300 hover:text-white"
          >
            ×
          </button>
        </div>
        <div className="max-h-[92vh] overflow-y-auto rounded-sm bg-[#0a0a0a]">
          {children}
        </div>
      </div>
    </div>
  );
}
