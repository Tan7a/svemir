"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-client";
import { setChannelParent, removeChannelParent } from "@/app/admin/actions";

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

export default function ChannelActions({
  channelId,
  channelTitle,
  hasParent,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [value, setValue] = useState("");
  const [allChannels, setAllChannels] = useState<
    { id: string; title: string }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
        <div className="absolute right-0 top-[calc(100%+6px)] z-20 w-64 overflow-hidden rounded-xl border border-neutral-800 bg-[#0f0f0f] p-1.5 shadow-2xl shadow-black/60">
          {!picking ? (
            <>
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
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-neutral-200 transition-colors hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span aria-hidden className="flex h-4 w-4 shrink-0 items-center justify-center text-neutral-400">
        {icon}
      </span>
      <span className="flex-1">{label}</span>
    </button>
  );
}
