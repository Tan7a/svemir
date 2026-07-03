"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { supabase } from "@/lib/supabase-client";

export type PickableBlock = {
  id: string;
  title: string;
  image_url: string | null;
  kind: "link" | "image" | "text" | "paper";
};

type Props = {
  /** Current block id - never offered as a match. */
  excludeId: string;
  /** Already-connected block ids - rendered as "connected" + not clickable. */
  excludeIds: string[];
  /** Fired when the user clicks a result. */
  onPick: (block: PickableBlock) => Promise<void> | void;
  busy?: boolean;
};

/**
 * Compact inline picker for the "+ connect block" affordance in BlockDetail.
 * Single-select: clicking a row fires onPick and the host component decides
 * what to do (typically: call the connectBlocks server action and close).
 */
export default function BlockPicker({
  excludeId,
  excludeIds,
  onPick,
  busy,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickableBlock[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const q = query.trim();
    const client = supabase;
    let cancelled = false;
    const handle = setTimeout(async () => {
      if (cancelled) return;
      if (!q || !client) {
        setResults([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      const { data } = await client
        .from("items")
        .select("id, title, image_url, kind")
        .ilike("title", `%${q}%`)
        .neq("id", excludeId)
        .order("created_at", { ascending: false })
        .limit(12);
      if (cancelled) return;
      setResults((data ?? []) as PickableBlock[]);
      setLoading(false);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, excludeId]);

  const excludeSet = useMemo(() => new Set(excludeIds), [excludeIds]);
  const q = query.trim();

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-2">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search blocks by title…"
        className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500"
        disabled={busy}
      />
      {!q ? (
        <p className="mt-2 text-[10px] text-neutral-500">
          Type to search across your blocks.
        </p>
      ) : loading ? (
        <p className="mt-2 text-[10px] text-neutral-500">Searching…</p>
      ) : results.length === 0 ? (
        <p className="mt-2 text-[10px] text-neutral-500">No matches.</p>
      ) : (
        <ul className="mt-2 max-h-72 overflow-y-auto">
          {results.map((r) => {
            const already = excludeSet.has(r.id);
            return (
              <li key={r.id}>
                <button
                  type="button"
                  disabled={already || busy}
                  onClick={() => onPick(r)}
                  className="flex w-full items-center gap-2 rounded-xl px-1.5 py-1 text-left text-xs text-neutral-200 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950">
                    {r.image_url ? (
                      <Image
                        src={r.image_url}
                        alt=""
                        fill
                        sizes="32px"
                        className="object-cover"
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-[10px] text-neutral-600">
                        {r.kind === "text" ? "T" : r.kind === "link" ? "↗" : "•"}
                      </span>
                    )}
                  </span>
                  <span className="flex-1 truncate">
                    {r.title || "Untitled"}
                  </span>
                  {already && (
                    <span className="text-[10px] text-neutral-500">
                      connected
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
