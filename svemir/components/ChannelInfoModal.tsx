"use client";

import { useEffect } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string | null;
  blockCount: number;
  createdAt: string;
  lastUpdated: string | null;
  topics: string[];
};

/** Absolute, locale-friendly date (pure - safe to call during render). */
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Detail popup for a channel, opened from the "…" menu. Shows the channel's
 * description plus derived stats (block count, created / last-updated dates,
 * nesting) and the most common topics across its blocks. Closes on Escape or a
 * click on the backdrop.
 */
export default function ChannelInfoModal({
  open,
  onClose,
  title,
  description,
  blockCount,
  createdAt,
  lastUpdated,
  topics,
}: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-950 p-6 shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 text-lg leading-none text-neutral-500 hover:text-neutral-200"
        >
          ×
        </button>

        <h2 className="pr-6 text-xl font-light text-neutral-100">{title}</h2>
        {description && (
          <p className="mt-2 text-sm leading-relaxed text-neutral-400">
            {description}
          </p>
        )}

        <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4">
          <Stat label="Blocks" value={String(blockCount)} />
          <Stat label="Created" value={fmtDate(createdAt)} />
          <Stat
            label="Last updated"
            value={lastUpdated ? fmtDate(lastUpdated) : "-"}
          />
        </dl>

        {topics.length > 0 && (
          <div className="mt-5">
            <div className="mb-2 text-[10px] uppercase tracking-wide text-neutral-500">
              Top topics
            </div>
            <div className="flex flex-wrap gap-1.5">
              {topics.map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-neutral-800 bg-neutral-900 px-2.5 py-1 text-xs text-neutral-300"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-neutral-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-neutral-200">{value}</dd>
    </div>
  );
}
