"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthed } from "@/lib/use-authed";
import {
  setChannelParent,
  removeChannelParent,
  deleteChannel,
  renameChannel,
  setChannelPrivacy,
  listAllChannelsAction,
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
  IconLock,
  IconEye,
} from "./ui/icons";

type Props = {
  channelId: string;
  channelTitle: string;
  /** Owner-only flag; public pages always pass false. */
  isPrivate?: boolean;
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
  isPrivate = false,
  hasParent,
  info,
}: Props) {
  const router = useRouter();
  const authed = useAuthed();
  const [open, setOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Second-step confirmation for deleting a private channel: the server
  // refuses the first call and reports how many blocks would become public.
  const [publishCount, setPublishCount] = useState<number | null>(null);
  const [channelsLoaded, setChannelsLoaded] = useState(false);
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
    // `channelsLoaded`, not `allChannels.length`: an owner with one channel
    // (filtered out below) would otherwise refetch on every menu open.
    if (channelsLoaded) return;
    // Server action, not the anon client: the owner's picker must include
    // private channels, which the anon key can't see (migration 0012).
    listAllChannelsAction()
      .then((data) => {
        setAllChannels(data.filter((c) => c.id !== channelId));
        setChannelsLoaded(true);
      })
      .catch(() => {
        // A server action rejects on network failure or deploy skew; without
        // this the picker stays empty forever with no explanation.
        setError("Couldn't load channels. Close the menu and try again.");
      });
  }, [picking, channelsLoaded, channelId]);

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

  async function togglePrivacy() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await setChannelPrivacy(channelId, !isPrivate);
    setBusy(false);
    if (result.success) {
      if (result.warning) {
        // Privacy WAS set, but some blocks failed concept sync; keep the menu
        // open so the owner actually sees the retry instruction.
        setError(result.warning);
        router.refresh();
        return;
      }
      setOpen(false);
      // A now-private channel 404s on its public URL (RLS hides it), so send
      // the owner to the admin mirror; going public routes back. The slug
      // comes from the action's response (server truth, survives renames).
      router.push(
        !isPrivate
          ? `/admin/channel/${result.slug}`
          : `/channel/${result.slug}`
      );
    } else {
      setError(result.error);
    }
  }

  function handleDelete() {
    setOpen(false);
    setConfirmOpen(true);
  }

  async function doDelete(confirmPublish = false) {
    setConfirmOpen(false);
    setPublishCount(null);
    setBusy(true);
    setError(null);
    const result = await deleteChannel(channelId, confirmPublish);
    setBusy(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    if ("needsConfirmation" in result) {
      // Private channel with members: the server refused to delete until the
      // owner confirms that its blocks will become public.
      setPublishCount(result.memberCount);
      return;
    }
    router.push("/?view=channels");
  }

  const hasExactMatch =
    value.trim() !== "" &&
    allChannels.some(
      (c) => c.title.toLowerCase() === value.trim().toLowerCase()
    );

  // Owner-only tooling (rename / nest / delete). Signed-out visitors get a clean
  // read-only channel; the server actions re-check real auth regardless.
  if (!authed) return null;

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
              <MenuItem
                leading={isPrivate ? <IconEye /> : <IconLock />}
                label={isPrivate ? "Make public" : "Make private"}
                onClick={togglePrivacy}
                disabled={busy}
              />
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
        message="Blocks stay in your archive - only their connection to this channel is removed. This can't be undone."
        confirmLabel="Delete channel"
        onConfirm={() => doDelete()}
        onCancel={() => setConfirmOpen(false)}
      />

      <ConfirmDialog
        open={publishCount !== null}
        tone="danger"
        title="This channel is private"
        message={`Deleting it will make ${publishCount === 1 ? "its 1 block" : `its ${publishCount} blocks`} public: they will show up on the home page, in search, and on the map, and their concepts will rejoin the public cloud. Remove the blocks from the channel first if they should stay hidden.`}
        confirmLabel="Delete and make blocks public"
        onConfirm={() => doDelete(true)}
        onCancel={() => setPublishCount(null)}
      />
    </div>
  );
}

