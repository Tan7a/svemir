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
import ChannelInfoModal from "./ChannelInfoModal";
import { MenuPanel, MenuItem } from "./ui/Menu";
import ConfirmDialog from "./ui/ConfirmDialog";
import {
  IconConnect,
  IconUnlink,
  IconTrash,
  IconEdit,
  IconInfo,
} from "./ui/icons";

type Props = {
  channelId: string;
  channelTitle: string;
  hasParent: boolean;
  /** When provided, a "Channel info" item opens a detail popup. */
  info?: {
    description: string | null;
    blockCount: number;
    createdAt: string;
    lastUpdated: string | null;
    topics: string[];
  };
};

export default function ChannelActions({
  channelId,
  channelTitle,
  hasParent,
  info,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
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

  function handleDelete() {
    setOpen(false);
    setConfirmOpen(true);
  }

  async function doDelete() {
    setConfirmOpen(false);
    setBusy(true);
    setError(null);
    const result = await deleteChannel(channelId);
    setBusy(false);
    if (result.success) {
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
        className="flex h-7 w-7 items-center justify-center rounded-xl text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100"
      >
        <span aria-hidden className="text-lg leading-none">⋯</span>
      </button>
      {open && (
        <MenuPanel className="absolute right-0 top-[calc(100%+6px)] z-20 w-max min-w-[11rem] max-w-xs">
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
                className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500"
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
                leading={<IconEdit />}
                label="Rename channel"
                onClick={() => {
                  setRenameValue(channelTitle);
                  setRenaming(true);
                }}
              />
              <MenuItem
                leading={<IconConnect />}
                label="Connect to channel…"
                onClick={() => setPicking(true)}
              />
              {hasParent && (
                <MenuItem
                  leading={<IconUnlink />}
                  label="Remove from parent"
                  onClick={detach}
                  disabled={busy}
                />
              )}
              {info && (
                <MenuItem
                  leading={<IconInfo />}
                  label="Channel info"
                  onClick={() => {
                    setInfoOpen(true);
                    setOpen(false);
                  }}
                />
              )}
              <div className="my-1 border-t border-neutral-800" />
              <MenuItem
                leading={<IconTrash />}
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
                className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500"
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
        </MenuPanel>
      )}
      {info && (
        <ChannelInfoModal
          open={infoOpen}
          onClose={() => setInfoOpen(false)}
          title={channelTitle}
          description={info.description}
          blockCount={info.blockCount}
          createdAt={info.createdAt}
          lastUpdated={info.lastUpdated}
          topics={info.topics}
        />
      )}

      <ConfirmDialog
        open={confirmOpen}
        tone="danger"
        title={`Delete “${channelTitle}”?`}
        message="Blocks stay in your archive — only their connection to this channel is removed. This can't be undone."
        confirmLabel="Delete channel"
        onConfirm={doDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

