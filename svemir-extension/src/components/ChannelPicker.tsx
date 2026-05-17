import { useEffect, useMemo, useRef, useState } from "react";
import type { RecentChannel, Suggestion } from "../lib/types";

type Props = {
  value: string[];
  onChange: (next: string[]) => void;
  suggestions?: Suggestion[];
  recents?: RecentChannel[];
  /** Set once when suggestions arrive to auto-tick high-score ones. */
  autoApplyKey?: string;
};

export default function ChannelPicker({
  value,
  onChange,
  suggestions = [],
  recents = [],
  autoApplyKey,
}: Props) {
  const [query, setQuery] = useState("");
  const userTouched = useRef(false);
  const appliedKey = useRef<string | null>(null);

  // Auto-apply high-confidence suggestions once per autoApplyKey,
  // unless the user has already touched the selection.
  useEffect(() => {
    if (!autoApplyKey || appliedKey.current === autoApplyKey) return;
    if (userTouched.current) return;
    const toAdd = suggestions
      .filter((s) => s.autoSelect)
      .map((s) => s.title);
    if (toAdd.length === 0) {
      appliedKey.current = autoApplyKey;
      return;
    }
    const set = new Set(value.map((v) => v.toLowerCase()));
    const next = [...value];
    for (const t of toAdd) {
      if (!set.has(t.toLowerCase())) {
        next.push(t);
        set.add(t.toLowerCase());
      }
    }
    if (next.length !== value.length) onChange(next);
    appliedKey.current = autoApplyKey;
  }, [autoApplyKey, suggestions, value, onChange]);

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

  function createAndAdd(title: string) {
    userTouched.current = true;
    const trimmed = title.trim();
    if (!trimmed) return;
    const set = new Set(value.map((v) => v.toLowerCase()));
    if (!set.has(trimmed.toLowerCase())) onChange([...value, trimmed]);
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
    for (const r of recents) {
      if (r.title.toLowerCase().includes(q) && !seen.has(r.title.toLowerCase())) {
        seen.add(r.title.toLowerCase());
        out.push(r.title);
      }
    }
    return out.slice(0, 15);
  }, [q, recents]);

  const exactMatch =
    q.length > 0 &&
    recents.some((r) => r.title.toLowerCase() === q);

  return (
    <div className="space-y-3">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type to search..."
          className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-500"
        />
      </div>

      {!q && suggestions.length > 0 && (
        <section>
          <h4 className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wide text-neutral-500">
            <span aria-hidden>✻</span> Suggested
          </h4>
          <ul className="divide-y divide-neutral-800 rounded-md border border-neutral-800 bg-neutral-900">
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
                    {selected && (
                      <span className="ml-2 text-xs text-neutral-500">✓</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {!q && recents.length > 0 && (
        <section>
          <h4 className="mb-1 text-[10px] uppercase tracking-wide text-neutral-500">
            Recent channels
          </h4>
          <ul className="divide-y divide-neutral-800 rounded-md border border-neutral-800 bg-neutral-900">
            {recents.slice(0, 8).map((r) => {
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
        <p className="rounded-md border border-dashed border-neutral-800 px-3 py-4 text-center text-xs text-neutral-500">
          No channels yet — type to create your first one.
        </p>
      )}

      {q && (
        <section>
          {matches.length > 0 && (
            <ul className="divide-y divide-neutral-800 rounded-md border border-neutral-800 bg-neutral-900">
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
          {!exactMatch && (
            <button
              type="button"
              onClick={() => createAndAdd(query)}
              className="mt-2 w-full rounded-md border border-dashed border-neutral-700 px-3 py-2 text-left text-sm text-neutral-300 hover:bg-neutral-900"
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
