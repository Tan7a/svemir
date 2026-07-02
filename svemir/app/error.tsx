"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Page error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a] p-8 text-neutral-300">
      <div className="max-w-lg text-center">
        <h1 className="text-2xl font-light text-neutral-100">
          Something went wrong
        </h1>
        <p className="mt-3 text-sm break-words text-neutral-400">
          {error.message || "An unexpected error occurred."}
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-xs text-neutral-600">
            digest: {error.digest}
          </p>
        )}
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-100 hover:bg-neutral-800"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-xl border border-neutral-700 px-4 py-2 text-sm font-medium text-neutral-300 hover:text-neutral-100"
          >
            Back to svemir
          </Link>
        </div>
      </div>
    </div>
  );
}
