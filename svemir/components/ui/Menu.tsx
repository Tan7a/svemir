"use client";

/**
 * Canonical dropdown-menu primitive for svemir.
 *
 * One source of truth for the "floating panel of rows" pattern used by the sort
 * dropdown, the channel "⋯" menu, and the block "Actions" menu. Callers keep
 * their own open/close state (outside-click, Escape) and positioning - this
 * only owns the *look*: panel chrome + row hover states.
 *
 * MenuPanel accepts arbitrary children (not just MenuItems) so callers can drop
 * inline forms (e.g. a rename input) inside the same styled surface.
 */

export function MenuPanel({
  className = "",
  children,
}: {
  /** Positioning + width classes (e.g. "absolute right-0 z-40 w-64"). */
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`glass-panel overflow-hidden rounded-xl border border-neutral-800 p-1.5 ${className}`}
    >
      {children}
    </div>
  );
}

export function MenuItem({
  leading,
  label,
  trailing,
  selected = false,
  danger = false,
  disabled = false,
  onClick,
}: {
  /** Icon or indicator (e.g. a radio dot) rendered in a fixed 4×4 slot. */
  leading?: React.ReactNode;
  label: React.ReactNode;
  /** Right-aligned adornment - a keyboard hint or badge. */
  trailing?: React.ReactNode;
  /** Current/active row: brighter label (pair with a filled `leading` dot). */
  selected?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-current={selected || undefined}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        danger
          ? "text-red-400 hover:bg-red-950/60"
          : selected
            ? "font-medium text-neutral-100 hover:bg-neutral-900/60"
            : "text-neutral-200 hover:bg-neutral-900/60"
      }`}
    >
      {leading !== undefined && (
        <span
          aria-hidden
          className={`flex h-4 w-4 shrink-0 items-center justify-center ${
            danger ? "text-red-400" : "text-neutral-400"
          }`}
        >
          {leading}
        </span>
      )}
      <span className="flex-1">{label}</span>
      {trailing}
    </button>
  );
}

/** Thin separator between groups of menu rows. */
export function MenuDivider() {
  return <div className="my-1 border-t border-neutral-800" />;
}

/**
 * Right-aligned tick for the active row in a single-select menu (sort orders,
 * etc.). Pass as a MenuItem's `trailing` when that row is selected - a cleaner
 * signal than a left-hand radio dot.
 */
export function MenuCheck() {
  return (
    <svg
      viewBox="0 0 12 12"
      className="h-3.5 w-3.5 text-neutral-100"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2.5 6.5 5 9l4.5-5.5" />
    </svg>
  );
}

/** Small caps label for a section inside a menu panel (e.g. above an input). */
export function MenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-1.5 pb-2 pt-1 text-[10px] uppercase tracking-wide text-neutral-500">
      {children}
    </p>
  );
}
