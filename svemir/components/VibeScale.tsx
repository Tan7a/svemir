"use client";

import { useRef } from "react";

type Props = {
  vibes: string[];
  index: number;
  /** Number of blocks in the currently-selected vibe. */
  count: number;
  onChange: (i: number) => void;
};

/**
 * Horizontal vibe scale, floating bottom-center of the Blocks view while the
 * "Vibes" order is active. One dot per top concept; click a dot or drag the
 * thumb to scrub, arrow keys work when focused. Custom pointer handling
 * (not a native <input type=range>) so the dots and pill thumb can match the
 * glass menus - flat, no glow. Width leaves room for the floating + button.
 */
export default function VibeScale({ vibes, index, count, onChange }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const max = Math.max(0, vibes.length - 1);
  const current = vibes[index] ?? "";

  /** Nearest stop for a pointer position, clamped to the track. */
  function indexFromX(clientX: number): number {
    const el = trackRef.current;
    if (!el || max === 0) return 0;
    const r = el.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return Math.round(t * max);
  }

  function onPointerDown(e: React.PointerEvent) {
    // Capture so the drag keeps working when the pointer leaves the track.
    e.currentTarget.setPointerCapture(e.pointerId);
    onChange(indexFromX(e.clientX));
  }

  function onPointerMove(e: React.PointerEvent) {
    if (e.buttons === 0) return; // hover, not a drag
    onChange(indexFromX(e.clientX));
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      onChange(Math.min(max, index + 1));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      onChange(Math.max(0, index - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      onChange(0);
    } else if (e.key === "End") {
      e.preventDefault();
      onChange(max);
    }
  }

  const pct = max === 0 ? 0 : (index / max) * 100;

  return (
    // bottom-16 on phones clears the maker pill + brand mark that share the
    // bottom edge there; from sm up they sit in the corners, so bottom-5 works.
    <div className="glass-panel fixed bottom-16 left-1/2 z-40 w-[min(34rem,calc(100vw-8.5rem))] -translate-x-1/2 rounded-2xl border border-neutral-800 px-5 pb-4 pt-3 sm:bottom-5">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="text-[10px] uppercase tracking-wide text-neutral-500">
            Vibe
          </span>
          <span
            className="truncate text-sm font-medium text-neutral-100"
            title={current}
          >
            {current || "-"}
          </span>
        </div>
        <span className="shrink-0 text-[10px] tabular-nums text-neutral-500">
          {count} block{count === 1 ? "" : "s"} · {index + 1}/{vibes.length}
        </span>
      </div>

      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Vibe"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={index}
        aria-valuetext={current}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={onKeyDown}
        className="relative h-9 cursor-pointer touch-none select-none rounded-xl focus:outline-none focus-visible:ring-1 focus-visible:ring-neutral-500"
      >
        {/* Dots and thumb share the same inset so their positions line up. */}
        <div className="absolute inset-x-3 inset-y-0">
          <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-between">
            {vibes.map((v, i) => (
              <span
                key={`${v}-${i}`}
                className={`h-1.5 w-1.5 rounded-full transition-colors ${
                  i === index ? "bg-neutral-100" : "bg-neutral-600"
                }`}
              />
            ))}
          </div>
          <div
            className="absolute top-1/2 h-7 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-neutral-100 transition-[left] duration-150 ease-out"
            style={{ left: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
