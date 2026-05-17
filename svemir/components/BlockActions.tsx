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

type Props = {
  blockId: string;
  url: string | null;
  imageUrl: string | null;
  inModal: boolean;
};

// Small inline Lucide-style icons. Inline so we don't add a dep.
const stroke = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function IconExternal() {
  return (
    <svg {...stroke}>
      <path d="M15 3h6v6" />
      <path d="M10 14L21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}
function IconEdit() {
  return (
    <svg {...stroke}>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5Z" />
    </svg>
  );
}
function IconUpload() {
  return (
    <svg {...stroke}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}
function IconRefresh() {
  return (
    <svg {...stroke}>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
      <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
    </svg>
  );
}
function IconDownload() {
  return (
    <svg {...stroke}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
function IconShare() {
  return (
    <svg {...stroke}>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
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
function IconPlus() {
  return (
    <svg {...stroke}>
      <line x1="5" y1="12" x2="19" y2="12" />
      <line x1="12" y1="5" x2="12" y2="19" />
    </svg>
  );
}

type Toast = { kind: "ok" | "error"; message: string };

export default function BlockActions({
  blockId,
  url,
  imageUrl,
  inModal,
}: Props) {
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
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

  // Keyboard shortcuts: E (edit in manage), D (download). Only when the menu
  // is open OR no text input is focused, to avoid hijacking typing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() === "e") {
        e.preventDefault();
        window.location.href = "/admin/manage";
      } else if (e.key.toLowerCase() === "d") {
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

  async function handleDelete() {
    setActionsOpen(false);
    if (!confirm("Delete this block? This cannot be undone.")) return;
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
          className={`rounded-md border px-3 py-1.5 text-xs transition-colors disabled:opacity-50 ${
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
            className={`rounded-md border px-3 py-1.5 text-xs transition-colors disabled:opacity-50 ${
              actionsOpen
                ? "border-neutral-200 bg-neutral-100 text-neutral-900"
                : "border-neutral-700 text-neutral-200 hover:bg-neutral-900"
            }`}
          >
            Actions <span className="ml-0.5">⌄</span>
          </button>
          {actionsOpen && (
            <div className="absolute left-0 top-[calc(100%+8px)] z-20 w-64 overflow-hidden rounded-xl border border-neutral-800 bg-[#0f0f0f] p-1.5 shadow-2xl shadow-black/60">
              <MenuItem
                icon={<IconExternal />}
                label="Open source"
                disabled={!url}
                onClick={handleOpenSource}
              />
              <MenuItem
                icon={<IconEdit />}
                label="Edit"
                shortcut="E"
                onClick={() => {
                  setActionsOpen(false);
                  window.location.href = "/admin/manage";
                }}
              />
              <MenuItem
                icon={<IconUpload />}
                label="Change image"
                onClick={triggerImageUpload}
              />
              <MenuItem
                icon={<IconRefresh />}
                label="Re-scrape metadata"
                disabled={!url}
                onClick={handleRescrape}
              />
              <MenuItem
                icon={<IconDownload />}
                label="Download image"
                shortcut="D"
                disabled={!imageUrl}
                onClick={handleDownload}
              />
              <MenuItem
                icon={<IconShare />}
                label="Copy link"
                onClick={handleCopyLink}
              />
              <div className="my-1 border-t border-neutral-800" />
              <MenuItem
                icon={<IconTrash />}
                label="Delete block"
                danger
                onClick={handleDelete}
              />
            </div>
          )}
        </div>
      </div>

      {picking && (
        <div className="rounded-md border border-neutral-800 bg-neutral-900 p-2">
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
    </div>
  );
}

function MenuItem({
  icon,
  label,
  shortcut,
  badge,
  danger,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  badge?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
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
      {shortcut && (
        <kbd className="rounded border border-neutral-800 bg-neutral-900 px-1.5 py-0.5 font-mono text-[10px] text-neutral-400">
          {shortcut}
        </kbd>
      )}
      {badge && (
        <span className="rounded bg-violet-400/20 px-1.5 py-0.5 text-[10px] font-medium text-violet-300">
          {badge}
        </span>
      )}
    </button>
  );
}
