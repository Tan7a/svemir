"use client";

import { useState } from "react";

type Props = { blockId: string };

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; text: string }
  | { status: "denied" }
  | { status: "error"; message: string };

/**
 * Owner-only full text for a paper. Lazy-loads from the gated route
 * `/api/papers/[id]/content`, which returns 403 to the public. The full text is
 * never in the page payload — it's fetched on demand and only delivered to the
 * authenticated owner, keeping the copyright gate intact.
 */
export default function PaperFullText({ blockId }: Props) {
  const [state, setState] = useState<State>({ status: "idle" });

  async function load() {
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/papers/${blockId}/content`);
      if (res.status === 403) return setState({ status: "denied" });
      const data = await res.json();
      if (!res.ok) {
        return setState({ status: "error", message: data.error ?? "Could not load." });
      }
      setState({ status: "ok", text: data.text });
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : "Could not load." });
    }
  }

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-950/60">
      <div className="flex items-center justify-between px-4 py-2.5">
        <span className="text-xs font-medium text-neutral-300">Full text</span>
        {state.status !== "ok" && (
          <button
            type="button"
            onClick={load}
            disabled={state.status === "loading"}
            className="rounded-md border border-neutral-700 px-2.5 py-1 text-xs text-neutral-200 transition-colors hover:bg-neutral-900 disabled:opacity-50"
          >
            {state.status === "loading" ? "Loading…" : "Read full text"}
          </button>
        )}
      </div>

      {state.status === "denied" && (
        <p className="px-4 pb-3 text-xs text-neutral-500">
          The full text is available to the owner only. Sign in to read it.
        </p>
      )}
      {state.status === "error" && (
        <p className="px-4 pb-3 text-xs text-red-400">{state.message}</p>
      )}
      {state.status === "ok" && (
        <article className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap border-t border-neutral-800 px-4 pb-4 pt-3 text-sm leading-relaxed text-neutral-300">
          {state.text}
        </article>
      )}
    </section>
  );
}
