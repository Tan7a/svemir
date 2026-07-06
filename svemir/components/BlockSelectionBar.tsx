"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChannelTag, Item } from "@/lib/types";
import { supabase } from "@/lib/supabase-client";
import { addChannelToBlock, bulkDeleteItems } from "@/app/admin/actions";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { IconFolder, IconDownload, IconTrash } from "@/components/ui/icons";

type SelBlock = Item & { channels?: ChannelTag[] };

type Props = {
  /** The currently-selected blocks (full objects, so Export has metadata). */
  selected: SelBlock[];
  /** Clear the selection (called after a successful bulk action). */
  onClear: () => void;
};


/**
 * Floating bulk-action bar for the blocks grid, Pinterest-style. Appears while
 * one or more blocks are selected. Add to channel loops the existing per-block
 * server action; Delete reuses bulkDeleteItems; Export builds a JSON file
 * client-side (no dependency). Mutations are gated server-side by isAuthed();
 * any failure is surfaced inline.
 */
export default function BlockSelectionBar({ selected, onClear }: Props) {
  const router = useRouter();
  const ids = useMemo(() => selected.map((b) => b.id), [selected]);
  const [picking, setPicking] = useState(false);
  const [value, setValue] = useState("");
  const [allChannels, setAllChannels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!picking) return;
    inputRef.current?.focus();
    if (allChannels.length || !supabase) return;
    supabase
      .from("channels")
      .select("title")
      .order("title")
      .then(({ data }) => {
        if (data) setAllChannels(data.map((c) => c.title as string));
      });
  }, [picking, allChannels.length]);

  const suggestions = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return allChannels.slice(0, 6);
    return allChannels.filter((n) => n.toLowerCase().includes(q)).slice(0, 6);
  }, [value, allChannels]);

  const hasExactMatch =
    value.trim() !== "" &&
    allChannels.some((c) => c.toLowerCase() === value.trim().toLowerCase());

  async function addToChannel(title: string) {
    const t = title.trim();
    if (!t || busy || ids.length === 0) return;
    setBusy(true);
    setError(null);
    // No bulk channel action exists; a per-id loop is fine for modest selections.
    for (const id of ids) {
      const result = await addChannelToBlock(id, t);
      if (!result.success) {
        setBusy(false);
        setError(result.error);
        return;
      }
    }
    setBusy(false);
    setValue("");
    setPicking(false);
    if (!allChannels.some((c) => c.toLowerCase() === t.toLowerCase())) {
      setAllChannels((prev) => [...prev, t].sort());
    }
    router.refresh();
    onClear();
  }

  function handleExport() {
    const data = selected.map((b) => ({
      id: b.id,
      title: b.title,
      url: b.url,
      source_name: b.source_name,
      kind: b.kind,
      image_url: b.image_url,
      channels: (b.channels ?? []).map((c) => c.title),
    }));
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `svemir-blocks-${data.length}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  }

  async function doDelete() {
    setConfirmOpen(false);
    if (busy || ids.length === 0) return;
    setBusy(true);
    setError(null);
    const result = await bulkDeleteItems(ids);
    setBusy(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    router.refresh();
    onClear();
  }

  const iconBtn =
    "flex h-9 w-9 items-center justify-center rounded-xl text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-white disabled:opacity-40";

  return (
    <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2">
      {/* Channel picker pops up above the bar. */}
      {picking && (
        <div className="mb-2 w-72 rounded-xl border border-neutral-800 bg-[#0f0f0f] p-2 shadow-panel">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addToChannel(value);
              } else if (e.key === "Escape") {
                setPicking(false);
                setValue("");
              }
            }}
            placeholder="Add all to channel…"
            className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500"
            disabled={busy}
          />
          {suggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => addToChannel(s)}
                  disabled={busy}
                  className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-700 disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          {value.trim() && !hasExactMatch && (
            <p className="mt-2 text-[10px] text-neutral-500">
              Press <kbd className="rounded bg-neutral-800 px-1">Enter</kbd> to
              create &ldquo;{value.trim()}&rdquo;.
            </p>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 rounded-2xl border border-neutral-800 bg-[#141414]/95 px-3 py-2 shadow-panel backdrop-blur">
        <span className="pl-1 text-sm font-medium text-neutral-100">
          {ids.length} selected
        </span>
        <button
          type="button"
          onClick={onClear}
          className="rounded-xl px-2 py-1 text-xs text-neutral-400 transition-colors hover:text-neutral-100"
        >
          Clear
        </button>

        <span className="mx-1 h-6 w-px bg-neutral-800" aria-hidden />

        <button
          type="button"
          aria-label="Add selected to a channel"
          title="Add to channel"
          onClick={() => setPicking((p) => !p)}
          disabled={busy}
          className={`${iconBtn} ${picking ? "bg-neutral-800 text-white" : ""}`}
        >
          <IconFolder />
        </button>
        <button
          type="button"
          aria-label="Export selected as JSON"
          title="Export as JSON"
          onClick={handleExport}
          disabled={busy}
          className={iconBtn}
        >
          <IconDownload />
        </button>
        <button
          type="button"
          aria-label="Delete selected"
          title="Delete"
          onClick={() => setConfirmOpen(true)}
          disabled={busy}
          className="flex h-9 w-9 items-center justify-center rounded-xl text-red-400 transition-colors hover:bg-red-950/60 hover:text-red-300 disabled:opacity-40"
        >
          <IconTrash />
        </button>

        {error && (
          <span className="max-w-[16rem] truncate pl-1 text-xs text-red-400">
            {error}
          </span>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        tone="danger"
        title={`Delete ${ids.length} block${ids.length === 1 ? "" : "s"}?`}
        message="This can't be undone."
        confirmLabel="Delete"
        onConfirm={doDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
