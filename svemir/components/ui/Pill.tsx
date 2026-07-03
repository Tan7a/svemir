/**
 * Pill atom - the small caps tag used for channels, categories, and facets.
 * Full-round border chip; `neutral-*` tokens so it retheme automatically.
 */
export default function Pill({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border border-neutral-800 bg-neutral-900 px-2 py-1 text-[9px] font-medium uppercase tracking-wide text-neutral-400 ${className}`}
    >
      {children}
    </span>
  );
}
