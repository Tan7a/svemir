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
    <div className="flex min-h-screen items-center justify-center bg-[#FBF8F4] p-8">
      <div className="max-w-lg text-center">
        <h1 className="text-2xl font-semibold text-zinc-900">
          Something went wrong
        </h1>
        <p className="mt-3 text-sm text-zinc-700 break-words">
          {error.message || "An unexpected error occurred."}
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-xs text-zinc-400">
            digest: {error.digest}
          </p>
        )}
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Try again
          </button>
          <Link
            href="/archive"
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Back to archive
          </Link>
        </div>
      </div>
    </div>
  );
}
