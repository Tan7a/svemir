import Link from "next/link";

/**
 * Interactive channel chip - the small-caps pill that links to a channel page.
 * Same full-round look as the Pill atom, but rendered as a Link with a hover
 * state. Shared by the Blocks grid cards and the block detail popup so both
 * stay visually identical. `neutral-*` tokens retheme automatically.
 */
export default function ChannelChip({
  slug,
  title,
  className = "",
}: {
  slug: string;
  title: string;
  className?: string;
}) {
  return (
    <Link
      href={`/channel/${slug}`}
      className={`inline-flex items-center rounded-full border border-neutral-800 bg-neutral-900 px-2 py-1 text-[9px] font-medium uppercase tracking-wide text-neutral-400 transition-colors hover:border-neutral-600 hover:text-neutral-100 ${className}`}
    >
      {title}
    </Link>
  );
}
