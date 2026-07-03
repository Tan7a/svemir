"use client";

type Props = {
  vibes: string[];
  index: number;
  /** Number of blocks in the currently-selected vibe. */
  count: number;
  onChange: (i: number) => void;
};

/**
 * A vertical scale that sits on the right edge of the Blocks view when the
 * "Vibes" order is active. Dragging it scrubs through the distinct vibes
 * (themes), and the always-visible label answers the old "which vibe?"
 * confusion. Hidden on narrow screens where a fixed rail would crowd the grid.
 */
export default function VibeScale({ vibes, index, count, onChange }: Props) {
  const max = Math.max(0, vibes.length - 1);
  const current = vibes[index] ?? "";

  return (
    <div className="fixed right-5 top-1/2 z-30 hidden -translate-y-1/2 flex-col items-center gap-4 md:flex">
      <div className="flex flex-col items-center gap-1">
        <span className="text-[10px] uppercase tracking-wide text-neutral-500">
          Vibe
        </span>
        <span
          className="max-w-[8rem] truncate text-center text-sm font-medium text-neutral-100"
          title={current}
        >
          {current || "-"}
        </span>
        <span className="text-[10px] text-neutral-500">
          {count} block{count === 1 ? "" : "s"}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={index}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Vibe scale"
        className="h-48 cursor-pointer"
        // Vertical orientation with top = last vibe. accent-color tracks the
        // active theme so the thumb is visible on every palette.
        style={{
          writingMode: "vertical-lr",
          direction: "rtl",
          accentColor: "var(--foreground)",
        }}
      />
      <span className="text-[10px] text-neutral-500">
        {vibes.length === 0 ? "0/0" : `${index + 1}/${vibes.length}`}
      </span>
    </div>
  );
}
