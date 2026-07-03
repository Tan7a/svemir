/**
 * Chevron atom - the dropdown-affordance caret. Rotates 180° when `open`.
 * Inherits colour via `currentColor`, size defaults to 12px.
 */
export default function Chevron({
  open = false,
  size = 12,
  className = "",
}: {
  open?: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 transition-transform ${open ? "rotate-180" : ""} ${className}`}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
