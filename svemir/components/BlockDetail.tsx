import Image from "next/image";
import Link from "next/link";
import type { ItemWithChannels } from "@/lib/types";
import BlockActions from "./BlockActions";
import BlockConnections from "./BlockConnections";
import EditableTitle from "./EditableTitle";
import { renameBlock } from "@/app/admin/actions";

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

function GlobeIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M15 3h6v6" />
      <path d="M10 14L21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

export default function BlockDetail({ block, inModal = false }: Props) {
  return (
    <div
      className={
        inModal
          ? "relative flex h-full flex-col gap-6 px-6 py-6"
          : "relative grid h-full grid-cols-1 gap-8 px-8 py-8 md:grid-cols-[1fr_22rem]"
      }
    >
      {/* Left column — image (clickable), URL bar, and body text */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-1 items-start justify-center">
          {block.image_url ? (
            block.url ? (
              <a
                href={block.url}
                target="_blank"
                rel="noopener noreferrer"
                title="Open source in new tab"
                className="block max-h-[70vh] w-full"
              >
                <Image
                  src={block.image_url}
                  alt={block.title}
                  width={1200}
                  height={1200}
                  sizes="(min-width: 768px) 60vw, 100vw"
                  className="h-auto max-h-[70vh] w-full object-contain"
                  priority
                />
              </a>
            ) : (
              <Image
                src={block.image_url}
                alt={block.title}
                width={1200}
                height={1200}
                sizes="(min-width: 768px) 60vw, 100vw"
                className="h-auto max-h-[70vh] w-full object-contain"
                priority
              />
            )
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

        {block.url && (
          <a
            href={block.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-2 self-start rounded-md border border-neutral-800 bg-neutral-900/60 px-3 py-1.5 text-xs text-neutral-300 transition-colors hover:border-neutral-700 hover:bg-neutral-900"
            title="Open source in new tab"
          >
            <span className="text-neutral-500">
              <GlobeIcon />
            </span>
            <span className="max-w-[42rem] truncate font-mono">
              {block.url}
            </span>
            <span className="text-neutral-600 opacity-0 transition-opacity group-hover:opacity-100">
              <ExternalIcon />
            </span>
          </a>
        )}

        {block.body_text && (
          <details className="mt-2 rounded-md border border-neutral-800 bg-neutral-950/60">
            <summary className="cursor-pointer select-none px-4 py-2 text-xs text-neutral-400 hover:text-neutral-200">
              Reader — page text saved at the time
            </summary>
            <article className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap px-4 pb-4 pt-1 text-sm leading-relaxed text-neutral-300">
              {block.body_text}
            </article>
          </details>
        )}
      </div>

      {/* Metadata. In the page layout this is the right column; in the side
          panel it stacks below the image as a single column. */}
      <aside className="flex flex-col gap-4 text-sm text-neutral-300">
        <header>
          <EditableTitle
            value={block.title}
            onRename={renameBlock.bind(null, block.id)}
            as="h1"
            className="cursor-text text-2xl font-light leading-tight text-neutral-100"
            inputClassName="w-full border-b border-neutral-500 bg-transparent text-2xl font-light leading-tight text-neutral-100 outline-none"
          />
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
          >
            Connections{" "}
            <span className="ml-1 text-neutral-500">
              {block.channels.length + block.connected_blocks.length}
            </span>
          </button>
        </div>

        <div className="text-xs">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-neutral-500">Channels</span>
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

        <BlockConnections
          blockId={block.id}
          initial={block.connected_blocks.map((b) => ({
            id: b.id,
            title: b.title,
            image_url: b.image_url,
            kind: b.kind,
          }))}
        />

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
    </div>
  );
}
