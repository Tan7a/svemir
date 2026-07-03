"use client";

/**
 * SelectionCircle atom - the Pinterest-style multi-select toggle shown on block
 * cards. Selected = filled white with a check; idle = translucent ring.
 *
 * Owns only the circle's appearance + behaviour. The caller supplies
 * positioning / visibility via `className` (e.g. "absolute right-2.5 top-2.5
 * z-20 opacity-0 group-hover:opacity-100").
 */
export default function SelectionCircle({
  selected,
  onClick,
  ariaLabel,
  className = "",
}: {
  selected: boolean;
  onClick?: (e: React.MouseEvent) => void;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel ?? (selected ? "Deselect" : "Select")}
      aria-pressed={selected}
      onClick={onClick}
      className={`flex h-6 w-6 items-center justify-center rounded-full border shadow-sm transition-all ${
        selected
          ? "border-white bg-white text-black"
          : "border-white/80 bg-black/50 text-transparent hover:bg-black/70"
      } ${className}`}
    >
      {selected && (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M20 6L9 17l-5-5" />
        </svg>
      )}
    </button>
  );
}
