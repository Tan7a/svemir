"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-client";
import {
  addChannelToBlock,
  deleteItem,
  scrapeAndUpdateItem,
  updateBlockImage,
} from "@/app/admin/actions";
import { MenuPanel, MenuItem, MenuDivider } from "./ui/Menu";
import Chevron from "./ui/Chevron";
import ConfirmDialog from "./ui/ConfirmDialog";
import {
  IconExternal,
  IconUpload,
  IconRefresh,
  IconDownload,
  IconShare,
  IconTrash,
  IconPlus,
} from "./ui/icons";

type Props = {
  blockId: string;
  url: string | null;
  imageUrl: string | null;
  inModal: boolean;
  /** Extra control(s) rendered in the button row, after "Actions" (e.g. Edit/Save). */
  extra?: React.ReactNode;
};

type Toast = { kind: "ok" | "error"; message: string };

export default function BlockActions({
  blockId,
  url,
  imageUrl,
  inModal,
  extra,
}: Props) {
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [value, setValue] = useState("");
  const [allChannels, setAllChannels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  // Click outside closes the actions menu
  useEffect(() => {
    if (!actionsOpen) return;
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setActionsOpen(false);
      }
    }
    window.addEventListener("mousedown", onDocClick);
    return () => window.removeEventListener("mousedown", onDocClick);
  }, [actionsOpen]);

  // Auto-clear transient toasts
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  // Keyboard shortcut: D (download image). Only when the menu is open and no
  // text input is focused, to avoid hijacking typing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() === "d") {
        e.preventDefault();
        handleDownload();
      }
    }
    if (actionsOpen) {
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionsOpen, imageUrl]);

  const suggestions = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return allChannels.slice(0, 6);
    return allChannels
      .filter((n) => n.toLowerCase().includes(q))
      .slice(0, 6);
  }, [value, allChannels]);

  async function connect(title: string) {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    setToast(null);
    const result = await addChannelToBlock(blockId, t);
    setBusy(false);
    if (result.success) {
      setValue("");
      setPicking(false);
      setAllChannels((prev) =>
        prev.some((c) => c.toLowerCase() === t.toLowerCase())
          ? prev
          : [...prev, t].sort()
      );
      router.refresh();
    } else {
      setToast({ kind: "error", message: result.error });
    }
  }

  function handleDelete() {
    setActionsOpen(false);
    setConfirmOpen(true);
  }

  async function doDelete() {
    setConfirmOpen(false);
    setBusy(true);
    const result = await deleteItem(blockId);
    setBusy(false);
    if (result.success) {
      if (inModal) router.back();
      else router.push("/");
    } else {
      setToast({ kind: "error", message: result.error });
    }
  }

  async function handleRescrape() {
    setActionsOpen(false);
    if (!url) {
      setToast({ kind: "error", message: "This block has no URL." });
      return;
    }
    setBusy(true);
    const result = await scrapeAndUpdateItem(blockId, url);
    setBusy(false);
    if (result.success) {
      setToast({ kind: "ok", message: "Metadata refreshed." });
      router.refresh();
    } else {
      setToast({ kind: "error", message: result.error });
    }
  }

  function handleDownload() {
    setActionsOpen(false);
    if (!imageUrl) {
      setToast({ kind: "error", message: "No image to download." });
      return;
    }
    // Open in a new tab — browser handles the download or display.
    window.open(imageUrl, "_blank", "noopener,noreferrer");
  }

  async function handleCopyLink() {
    setActionsOpen(false);
    const link = `${window.location.origin}/block/${blockId}`;
    try {
      await navigator.clipboard.writeText(link);
      setToast({ kind: "ok", message: "Link copied." });
    } catch {
      setToast({ kind: "error", message: "Couldn't copy to clipboard." });
    }
  }

  function handleOpenSource() {
    setActionsOpen(false);
    if (!url) {
      setToast({ kind: "error", message: "This block has no URL." });
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function triggerImageUpload() {
    setActionsOpen(false);
    fileInputRef.current?.click();
  }

  async function handleImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setToast(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload-image", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        setToast({ kind: "error", message: data.error ?? "Upload failed" });
        return;
      }
      const result = await updateBlockImage(blockId, data.url);
      if (!result.success) {
        setToast({ kind: "error", message: result.error });
        return;
      }
      setToast({ kind: "ok", message: "Image updated." });
      router.refresh();
    } catch (err) {
      setToast({
        kind: "error",
        message: err instanceof Error ? err.message : "Upload failed",
      });
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const hasExactMatch =
    value.trim() !== "" &&
    allChannels.some((c) => c.toLowerCase() === value.trim().toLowerCase());

  return (
    <div className="flex flex-col gap-2 pt-1">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageFile}
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setPicking((p) => !p);
            setActionsOpen(false);
          }}
          disabled={busy}
          className={`rounded-xl border px-3 py-1.5 text-xs transition-colors disabled:opacity-50 ${
            picking
              ? "border-neutral-200 bg-neutral-100 text-neutral-900"
              : "border-neutral-700 text-neutral-200 hover:bg-neutral-900"
          }`}
        >
          Connect <span className="ml-1">→</span>
        </button>
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => {
              setActionsOpen((o) => !o);
              setPicking(false);
            }}
            disabled={busy}
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs transition-colors disabled:opacity-50 ${
              actionsOpen
                ? "border-neutral-200 bg-neutral-100 text-neutral-900"
                : "border-neutral-700 text-neutral-200 hover:bg-neutral-900"
            }`}
          >
            <span>Actions</span>
            <Chevron open={actionsOpen} />
          </button>
          {actionsOpen && (
            <MenuPanel className="absolute left-0 top-[calc(100%+8px)] z-20 w-64">
              <MenuItem
                leading={<IconExternal />}
                label="Open source"
                disabled={!url}
                onClick={handleOpenSource}
              />
              <MenuItem
                leading={<IconUpload />}
                label="Change image"
                onClick={triggerImageUpload}
              />
              <MenuItem
                leading={<IconRefresh />}
                label="Re-scrape metadata"
                disabled={!url}
                onClick={handleRescrape}
              />
              <MenuItem
                leading={<IconDownload />}
                label="Download image"
                trailing={
                  <kbd className="rounded border border-neutral-800 bg-neutral-900 px-1.5 py-0.5 font-mono text-[10px] text-neutral-400">
                    D
                  </kbd>
                }
                disabled={!imageUrl}
                onClick={handleDownload}
              />
              <MenuItem
                leading={<IconShare />}
                label="Copy link"
                onClick={handleCopyLink}
              />
              <MenuDivider />
              <MenuItem
                leading={<IconTrash />}
                label="Delete block"
                danger
                onClick={handleDelete}
              />
            </MenuPanel>
          )}
        </div>
        {extra}
      </div>

      {picking && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-2">
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
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => connect(s)}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-700 disabled:opacity-50"
                >
                  <IconPlus /> {s}
                </button>
              ))}
            </div>
          )}
          {value.trim() && !hasExactMatch && (
            <p className="mt-2 text-[10px] text-neutral-500">
              Press <kbd className="rounded bg-neutral-800 px-1">Enter</kbd> to create a new channel &ldquo;{value.trim()}&rdquo;.
            </p>
          )}
        </div>
      )}

      {toast && (
        <p
          className={`text-xs ${
            toast.kind === "error" ? "text-red-400" : "text-emerald-400"
          }`}
        >
          {toast.message}
        </p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        tone="danger"
        title="Delete this block?"
        message="This can't be undone."
        confirmLabel="Delete"
        onConfirm={doDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
