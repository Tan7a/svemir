import Image from "next/image";
import Link from "next/link";
import type { ItemWithChannels } from "@/lib/types";
import BlockActions from "./BlockActions";

type Props = {
  block: ItemWithChannels;
  /** When true, renders without the outer page chrome (close X / nav handled by Modal wrapper). */
  inModal?: boolean;
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? "" : "s"} ago`;
  const yr = Math.floor(mo / 12);
  return `${yr} year${yr === 1 ? "" : "s"} ago`;
}

/**
 * Block detail view — used by both the full-page route at /block/[id] and
 * the intercepted @modal/(.)block/[id] modal route.
 *
 * IA per the screenshot: image left ~60%, metadata sidebar right, source URL
 * at the bottom. The Comments tab is hidden in svemir (no social layer);
 * the Connect → and Actions ⌄ buttons are present but inert until Phase B.
 */
export default function BlockDetail({ block, inModal = false }: Props) {
  return (
    <div className="relative grid h-full grid-cols-1 gap-8 px-8 py-8 md:grid-cols-[1fr_22rem]">
      {/* Left — image / text body */}
      <div className="flex items-center justify-center">
        {block.image_url ? (
          <div className="relative max-h-[80vh] w-full">
            <Image
              src={block.image_url}
              alt={block.title}
              width={1200}
              height={1200}
              sizes="(min-width: 768px) 60vw, 100vw"
              className="h-auto max-h-[80vh] w-full object-contain"
              priority
            />
          </div>
        ) : block.kind === "text" && block.description ? (
          <article className="prose prose-invert max-w-prose whitespace-pre-wrap text-neutral-200">
            {block.description}
          </article>
        ) : (
          <div className="flex h-64 w-full items-center justify-center border border-neutral-800 bg-neutral-900 text-neutral-700">
            No image
          </div>
        )}
      </div>

      {/* Right — metadata sidebar */}
      <aside className="flex flex-col gap-4 text-sm text-neutral-300">
        <header>
          <h1 className="text-2xl font-light leading-tight text-neutral-100">
            {block.title || "Untitled"}
          </h1>
          {block.description && block.kind !== "text" ? (
            <p className="mt-1 text-neutral-400">{block.description}</p>
          ) : !block.description ? (
            <p className="mt-1 text-neutral-600">No description</p>
          ) : null}
        </header>

        <dl className="space-y-1.5 text-xs">
          <div className="flex justify-between gap-4">
            <dt className="text-neutral-500">Added</dt>
            <dd className="text-neutral-300">
              {relativeTime(block.created_at)}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-neutral-500">By</dt>
            <dd className="text-neutral-300">Tanja Radovanovic</dd>
          </div>
          {(block.source_name || block.url) && (
            <div className="flex justify-between gap-4">
              <dt className="text-neutral-500">Source</dt>
              <dd className="truncate text-right text-neutral-200">
                {block.url ? (
                  <a
                    href={block.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
                    {block.source_name || new URL(block.url).hostname}
                  </a>
                ) : (
                  block.source_name
                )}
              </dd>
            </div>
          )}
        </dl>

        <BlockActions
          blockId={block.id}
          url={block.url}
          imageUrl={block.image_url}
          inModal={inModal}
        />

        <div className="mt-2 border-b border-neutral-800">
          <button
            type="button"
            className="border-b-2 border-neutral-200 px-0 py-1.5 text-xs text-neutral-100"
            // Comments tab intentionally omitted in svemir.
          >
            Connections{" "}
            <span className="ml-1 text-neutral-500">
              {block.channels.length}
            </span>
          </button>
        </div>

        <div className="text-xs">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-neutral-500">Your connections</span>
            <span className="text-neutral-600">
              {block.channels.length === 0
                ? "—"
                : relativeTime(block.created_at)}
            </span>
          </div>
          {block.channels.length === 0 ? (
            <p className="text-neutral-600">No channels yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {block.channels.map((c) => (
                <li key={c.id} className="flex items-baseline justify-between">
                  <Link
                    href={`/channel/${c.slug}`}
                    className="text-neutral-200 hover:underline"
                  >
                    {c.title}
                  </Link>
                  <span className="text-neutral-500">
                    Tanja Radovanovic
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {!inModal && (
          <div className="mt-auto pt-6">
            <Link
              href="/"
              className="text-xs text-neutral-500 hover:text-neutral-200"
            >
              ← back to svemir
            </Link>
          </div>
        )}
      </aside>

      {block.url && (
        <div className="absolute bottom-2 left-8 right-8 truncate text-[10px] text-neutral-700">
          {block.url}
        </div>
      )}
    </div>
  );
}
