"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Suggestion } from "@/lib/suggest";
import type { RecentChannel } from "@/lib/channels";
import { supabase } from "@/lib/supabase-client";

type Props = {
  value: string[];
  onChange: (next: string[]) => void;
  suggestions?: Suggestion[];
  recents?: RecentChannel[];
  /** Set true once when AI suggestions arrive to auto-tick high-score ones. */
  autoApplyKey?: string;
};

/**
 * Multi-select channel picker:
 *  - Selected chips at top.
 *  - Search filters across All channels (cached on first focus).
 *  - Suggested section appears when `suggestions` is non-empty.
 *  - Recent section shows top recently-connected channels.
 *  - "+ Create new channel" affordance when search has no matches.
 */
export default function ChannelPicker({
  value,
  onChange,
  suggestions = [],
  recents = [],
  autoApplyKey,
}: Props) {
  const [query, setQuery] = useState("");
  const [allTitles, setAllTitles] = useState<string[]>([]);
  const [allLoaded, setAllLoaded] = useState(false);
  const userTouched = useRef(false);
  const appliedKey = useRef<string | null>(null);

  // Auto-apply high-confidence suggestions exactly once per autoApplyKey,
  // and only if the user hasn't manually touched the selection yet.
  useEffect(() => {
    if (!autoApplyKey || appliedKey.current === autoApplyKey) return;
    if (userTouched.current) return;
    const toAdd = suggestions
      .filter((s) => s.autoSelect)
      .map((s) => s.title.toLowerCase());
    if (toAdd.length === 0) {
      appliedKey.current = autoApplyKey;
      return;
    }
    const set = new Set(value.map((v) => v.toLowerCase()));
    const next = [...value];
    for (const title of toAdd) {
      if (!set.has(title)) {
        next.push(title);
        set.add(title);
      }
    }
    if (next.length !== value.length) onChange(next);
    appliedKey.current = autoApplyKey;
  }, [autoApplyKey, suggestions, value, onChange]);

  // Lazy-fetch all channel titles when the user starts typing.
  useEffect(() => {
    if (!query || allLoaded || !supabase) return;
    supabase
      .from("channels")
      .select("title")
      .order("title")
      .then(({ data }) => {
        if (data) setAllTitles(data.map((r) => r.title as string));
        setAllLoaded(true);
      });
  }, [query, allLoaded]);

  function toggle(title: string) {
    userTouched.current = true;
    const lower = title.toLowerCase();
    const set = new Set(value.map((v) => v.toLowerCase()));
    if (set.has(lower)) {
      onChange(value.filter((v) => v.toLowerCase() !== lower));
    } else {
      onChange([...value, title]);
    }
  }

  function remove(title: string) {
    userTouched.current = true;
    onChange(value.filter((v) => v.toLowerCase() !== title.toLowerCase()));
  }

  function createAndAdd(title: string) {
    userTouched.current = true;
    const trimmed = title.trim();
    if (!trimmed) return;
    const set = new Set(value.map((v) => v.toLowerCase()));
    if (!set.has(trimmed.toLowerCase())) {
      onChange([...value, trimmed]);
    }
    setQuery("");
  }

  const valueLower = useMemo(
    () => new Set(value.map((v) => v.toLowerCase())),
    [value]
  );

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    const push = (t: string) => {
      const k = t.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push(t);
      }
    };
    for (const r of recents) {
      if (r.title.toLowerCase().includes(q)) push(r.title);
    }
    for (const t of allTitles) {
      if (t.toLowerCase().includes(q)) push(t);
    }
    return out.slice(0, 20);
  }, [q, recents, allTitles]);

  const exactMatch =
    q.length > 0 &&
    [...allTitles, ...recents.map((r) => r.title)].some(
      (t) => t.toLowerCase() === q
    );

  return (
    <div className="space-y-3">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-full bg-neutral-800 px-2.5 py-1 text-xs text-neutral-200"
            >
              {t}
              <button
                type="button"
                onClick={() => remove(t)}
                className="text-neutral-500 hover:text-neutral-200"
                aria-label={`Remove ${t}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search or create a channel…"
        className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-500"
      />

      {!q && suggestions.length > 0 && (
        <section>
          <h4 className="mb-1 flex items-center gap-1 text-xs uppercase tracking-wide text-neutral-500">
            <span aria-hidden>✻</span> Suggested
          </h4>
          <ul className="divide-y divide-neutral-800 rounded-xl border border-neutral-800 bg-neutral-900">
            {suggestions.map((s) => {
              const selected = valueLower.has(s.title.toLowerCase());
              return (
                <li key={s.title}>
                  <button
                    type="button"
                    onClick={() => toggle(s.title)}
                    className={`flex w-full items-center justify-between px-3 py-2 text-sm transition-colors ${
                      selected
                        ? "bg-neutral-800 text-neutral-100"
                        : "text-neutral-200 hover:bg-neutral-800"
                    }`}
                  >
                    <span className="truncate">{s.title}</span>
                    <span className="ml-2 text-xs text-neutral-500">
                      {selected ? "✓" : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {!q && recents.length > 0 && (
        <section>
          <h4 className="mb-1 text-xs uppercase tracking-wide text-neutral-500">
            Recent channels
          </h4>
          <ul className="divide-y divide-neutral-800 rounded-xl border border-neutral-800 bg-neutral-900">
            {recents.slice(0, 10).map((r) => {
              const selected = valueLower.has(r.title.toLowerCase());
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => toggle(r.title)}
                    className={`flex w-full items-center justify-between px-3 py-2 text-sm transition-colors ${
                      selected
                        ? "bg-neutral-800 text-neutral-100"
                        : "text-neutral-200 hover:bg-neutral-800"
                    }`}
                  >
                    <span className="truncate">{r.title}</span>
                    <span className="ml-2 text-xs text-neutral-500">
                      {selected ? "✓ " : ""}
                      {r.block_count}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {!q && recents.length === 0 && suggestions.length === 0 && (
        <p className="rounded-xl border border-dashed border-neutral-800 px-3 py-4 text-center text-xs text-neutral-500">
          No channels yet - type to create your first one.
        </p>
      )}

      {q && (
        <section>
          {matches.length > 0 && (
            <ul className="divide-y divide-neutral-800 rounded-xl border border-neutral-800 bg-neutral-900">
              {matches.map((t) => {
                const selected = valueLower.has(t.toLowerCase());
                return (
                  <li key={t}>
                    <button
                      type="button"
                      onClick={() => toggle(t)}
                      className={`flex w-full items-center justify-between px-3 py-2 text-sm transition-colors ${
                        selected
                          ? "bg-neutral-800 text-neutral-100"
                          : "text-neutral-200 hover:bg-neutral-800"
                      }`}
                    >
                      <span className="truncate">{t}</span>
                      {selected && (
                        <span className="ml-2 text-xs text-neutral-500">✓</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {!exactMatch && q && (
            <button
              type="button"
              onClick={() => createAndAdd(query)}
              className="mt-2 w-full rounded-xl border border-dashed border-neutral-700 px-3 py-2 text-left text-sm text-neutral-300 hover:bg-neutral-900"
            >
              + Create new channel:{" "}
              <span className="text-neutral-100">&quot;{query}&quot;</span>
            </button>
          )}
        </section>
      )}
    </div>
  );
}
