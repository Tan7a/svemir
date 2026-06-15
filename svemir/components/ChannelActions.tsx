"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-client";
import {
  setChannelParent,
  removeChannelParent,
  deleteChannel,
  renameChannel,
} from "@/app/admin/actions";

type Props = {
  channelId: string;
  channelTitle: string;
  hasParent: boolean;
};

const stroke = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function IconConnect() {
  return (
    <svg {...stroke}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}
function IconUnlink() {
  return (
    <svg {...stroke}>
      <path d="M18.84 12.25l1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M5.16 11.75l-1.72 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}
function IconTrash() {
  return (
    <svg {...stroke}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}
function IconPencil() {
  return (
    <svg {...stroke}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export default function ChannelActions({
  channelId,
  channelTitle,
  hasParent,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(channelTitle);
  const [value, setValue] = useState("");
  const [allChannels, setAllChannels] = useState<
    { id: string; title: string }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) {
      renameRef.current?.focus();
      renameRef.current?.select();
    }
  }, [renaming]);

  useEffect(() => {
    if (!picking) return;
    inputRef.current?.focus();
    if (allChannels.length || !supabase) return;
    supabase
      .from("channels")
      .select("id, title")
      .order("title")
      .then(({ data }) => {
        if (data) {
          setAllChannels(
            (data as { id: string; title: string }[]).filter(
              (c) => c.id !== channelId
            )
          );
        }
      });
  }, [picking, allChannels.length, channelId]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
        setPicking(false);
        setRenaming(false);
      }
    }
    window.addEventListener("mousedown", onDocClick);
    return () => window.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const suggestions = useMemo(() => {
    const q = value.trim().toLowerCase();
    const base = allChannels;
    if (!q) return base.slice(0, 6);
    return base
      .filter((c) => c.title.toLowerCase().includes(q))
      .slice(0, 6);
  }, [value, allChannels]);

  async function connect(parentTitle: string) {
    const t = parentTitle.trim();
    if (!t || busy) return;
    setBusy(true);
    setError(null);
    const result = await setChannelParent(channelId, t);
    setBusy(false);
    if (result.success) {
      setOpen(false);
      setPicking(false);
      setValue("");
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  async function handleRename() {
    const t = renameValue.trim();
    if (!t || busy) return;
    setBusy(true);
    setError(null);
    const result = await renameChannel(channelId, t);
    setBusy(false);
    if (result.success) {
      setRenaming(false);
      setOpen(false);
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  async function detach() {
    setBusy(true);
    setError(null);
    const result = await removeChannelParent(channelId);
    setBusy(false);
    if (result.success) {
      setOpen(false);
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  async function handleDelete() {
    if (
      !confirm(
        `Delete channel "${channelTitle}"? Blocks will stay, but their connection to this channel will be removed. This cannot be undone.`
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    const result = await deleteChannel(channelId);
    setBusy(false);
    if (result.success) {
      setOpen(false);
      router.push("/?view=channels");
    } else {
      setError(result.error);
    }
  }

  const hasExactMatch =
    value.trim() !== "" &&
    allChannels.some(
      (c) => c.title.toLowerCase() === value.trim().toLowerCase()
    );

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        aria-label={`Actions for ${channelTitle}`}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen((o) => !o);
        }}
        className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100"
      >
        <span aria-hidden className="text-lg leading-none">⋯</span>
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-20 w-64 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950 p-1.5 shadow-2xl shadow-black/60">
          {renaming ? (
            <div className="p-1.5">
              <p className="mb-2 text-[10px] uppercase tracking-wide text-neutral-500">
                Rename channel
              </p>
              <input
                ref={renameRef}
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleRename();
                  } else if (e.key === "Escape") {
                    setRenaming(false);
                  }
                }}
                placeholder="Channel name…"
                className="w-full rounded-sm border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500"
                disabled={busy}
              />
              <p className="mt-2 text-[10px] text-neutral-500">
                Press <kbd className="rounded bg-neutral-800 px-1">Enter</kbd> to
                save.
              </p>
            </div>
          ) : !picking ? (
            <>
              <MenuItem
                icon={<IconPencil />}
                label="Rename channel"
                onClick={() => {
                  setRenameValue(channelTitle);
                  setRenaming(true);
                }}
              />
              <MenuItem
                icon={<IconConnect />}
                label="Connect to channel…"
                onClick={() => setPicking(true)}
              />
              {hasParent && (
                <MenuItem
                  icon={<IconUnlink />}
                  label="Remove from parent"
                  onClick={detach}
                  disabled={busy}
                />
              )}
              <div className="my-1 border-t border-neutral-800" />
              <MenuItem
                icon={<IconTrash />}
                label="Delete channel"
                onClick={handleDelete}
                disabled={busy}
                danger
              />
            </>
          ) : (
            <div className="p-1.5">
              <p className="mb-2 text-[10px] uppercase tracking-wide text-neutral-500">
                Nest &ldquo;{channelTitle}&rdquo; inside…
              </p>
              <input
                ref={inputRef}
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    connect(value);
                  } else if (e.key === "Escape") {
                    setPicking(false);
                    setValue("");
                  }
                }}
                placeholder="Type a channel name…"
                className="w-full rounded-sm border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500"
                disabled={busy}
              />
              {suggestions.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {suggestions.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => connect(c.title)}
                      disabled={busy}
                      className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-700 disabled:opacity-50"
                    >
                      {c.title}
                    </button>
                  ))}
                </div>
              )}
              {value.trim() && !hasExactMatch && (
                <p className="mt-2 text-[10px] text-neutral-500">
                  Press <kbd className="rounded bg-neutral-800 px-1">Enter</kbd> to create &ldquo;{value.trim()}&rdquo;.
                </p>
              )}
            </div>
          )}
          {error && (
            <p className="px-3 py-2 text-xs text-red-400">{error}</p>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        danger
          ? "text-red-400 hover:bg-red-950/50"
          : "text-neutral-200 hover:bg-neutral-900"
      }`}
    >
      <span
        aria-hidden
        className={`flex h-4 w-4 shrink-0 items-center justify-center ${
          danger ? "text-red-400" : "text-neutral-400"
        }`}
      >
        {icon}
      </span>
      <span className="flex-1">{label}</span>
    </button>
  );
}
