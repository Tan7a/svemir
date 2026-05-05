"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase-client";
import { createChannel } from "@/app/admin/actions";

export type ChannelOption = {
  id: string;
  name: string;
  slug: string;
  recentCount?: number;
};

type Props = {
  selected: string[];
  onChange: (ids: string[]) => void;
  mode?: "connect" | "filter";
  ctaLabel?: string;
  onCommit?: () => void;
  busy?: boolean;
  allowCreate?: boolean;
  className?: string;
};

const RECENT_KEY = "ia.recent_channels";
const RECENT_MAX = 6;

function readRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

export function pushRecentChannels(ids: string[]) {
  if (typeof window === "undefined") return;
  const existing = readRecent();
  const next = [...ids, ...existing.filter((id) => !ids.includes(id))].slice(
    0,
    RECENT_MAX
  );
  window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

export default function ConnectPicker({
  selected,
  onChange,
  mode = "connect",
  ctaLabel,
  onCommit,
  busy = false,
  allowCreate = true,
  className,
}: Props) {
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [search, setSearch] = useState("");
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    setRecentIds(readRecent());
    if (!supabase) return;
    supabase
      .from("channels")
      .select("id, name, slug")
      .order("name")
      .then(({ data }) => {
        if (data) setChannels(data as ChannelOption[]);
      });
  }, []);

  const trimmed = search.trim();
  const lc = trimmed.toLowerCase();

  const filtered = useMemo(() => {
    if (!lc) return channels;
    return channels.filter((c) => c.name.toLowerCase().includes(lc));
  }, [channels, lc]);

  const recent = useMemo(() => {
    const map = new Map(channels.map((c) => [c.id, c]));
    return recentIds
      .map((id) => map.get(id))
      .filter((c): c is ChannelOption => !!c);
  }, [channels, recentIds]);

  const exactMatchExists = useMemo(
    () => channels.some((c) => c.name.toLowerCase() === lc),
    [channels, lc]
  );
  const showCreateRow = allowCreate && !!trimmed && !exactMatchExists;

  function toggle(id: string) {
    onChange(
      selected.includes(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id]
    );
  }

  async function handleCreate() {
    if (!trimmed) return;
    setCreating(true);
    setCreateError(null);
    const r = await createChannel(trimmed);
    setCreating(false);
    if (!r.success) {
      setCreateError(r.error);
      return;
    }
    setChannels((prev) =>
      prev.some((c) => c.id === r.channel.id) ? prev : [...prev, r.channel]
    );
    onChange([...selected, r.channel.id]);
    setSearch("");
  }

  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      <input
        type="text"
        placeholder="Type to search…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && showCreateRow) {
            e.preventDefault();
            handleCreate();
          }
        }}
        className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
      />

      <div className="max-h-64 overflow-y-auto rounded-md border border-zinc-200 bg-white">
        {!trimmed && recent.length > 0 && (
          <div>
            <p className="border-b border-zinc-100 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              Recent channels
            </p>
            {recent.map((c) => (
              <Row
                key={`r-${c.id}`}
                channel={c}
                selected={selected.includes(c.id)}
                onToggle={() => toggle(c.id)}
              />
            ))}
          </div>
        )}

        {filtered.length === 0 && !showCreateRow && (
          <p className="px-3 py-3 text-xs text-zinc-500">
            {channels.length === 0
              ? "No channels yet. Type a name above to create one."
              : "No matches."}
          </p>
        )}

        {filtered.length > 0 && (
          <div>
            {!trimmed && recent.length > 0 && (
              <p className="border-b border-t border-zinc-100 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                All channels
              </p>
            )}
            {filtered.map((c) => (
              <Row
                key={c.id}
                channel={c}
                selected={selected.includes(c.id)}
                onToggle={() => toggle(c.id)}
              />
            ))}
          </div>
        )}

        {showCreateRow && (
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating}
            className="flex w-full items-center justify-between border-t border-zinc-100 bg-zinc-50 px-3 py-2 text-left text-sm text-zinc-800 hover:bg-zinc-100 disabled:opacity-50"
          >
            <span>
              <span className="text-zinc-500">+ New channel:</span>{" "}
              <strong>{trimmed}</strong>
            </span>
            {creating && <span className="text-xs text-zinc-500">…</span>}
          </button>
        )}
      </div>

      {createError && (
        <p className="text-xs text-red-600">{createError}</p>
      )}

      {ctaLabel && onCommit && (
        <button
          type="button"
          onClick={onCommit}
          disabled={busy || selected.length === 0}
          className="w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy
            ? "Saving…"
            : ctaLabel.replace("{n}", String(selected.length))}
        </button>
      )}

      {mode === "filter" && selected.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([])}
          className="text-xs text-zinc-500 hover:text-zinc-900"
        >
          Clear selection
        </button>
      )}
    </div>
  );
}

function Row({
  channel,
  selected,
  onToggle,
}: {
  channel: ChannelOption;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${
        selected
          ? "bg-zinc-900 text-white"
          : "text-zinc-800 hover:bg-zinc-50"
      }`}
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] ${
          selected
            ? "border-white bg-white text-zinc-900"
            : "border-zinc-300 text-transparent"
        }`}
      >
        ✓
      </span>
      <span className="flex-1 truncate">{channel.name}</span>
      {channel.recentCount != null && (
        <span
          className={`text-xs ${selected ? "text-white/70" : "text-zinc-400"}`}
        >
          {channel.recentCount}
        </span>
      )}
    </button>
  );
}
