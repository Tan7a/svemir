"use client";

import Image from "next/image";
import Link from "next/link";
import ChannelChip from "./ui/ChannelChip";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ItemWithChannels } from "@/lib/types";
import BlockActions from "./BlockActions";
import BlockConnections from "./BlockConnections";
import PaperDetail from "./PaperDetail";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { renameBlock, updateBlockDescription } from "@/app/admin/actions";

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
  const router = useRouter();
  // Explicit Edit → Save/Cancel mode, mirroring PaperDetail. The Edit control is
  // handed to BlockActions via its `extra` slot so it sits beside "Actions".
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(block.title);
  const [descriptionDraft, setDescriptionDraft] = useState(block.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    // Text blocks edit in the full WYSIWYG composer (FloatingAdd listens for
    // this); other kinds keep the inline title/description edit.
    if (block.kind === "text") {
      window.dispatchEvent(
        new CustomEvent("svemir:edit-text", {
          detail: {
            id: block.id,
            title: block.title,
            description: block.description ?? "",
          },
        })
      );
      return;
    }
    setTitleDraft(block.title);
    setDescriptionDraft(block.description ?? "");
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const ops: Promise<{ success: true } | { success: false; error: string }>[] = [];
    const nextTitle = titleDraft.trim();
    if (nextTitle && nextTitle !== block.title) {
      ops.push(renameBlock(block.id, nextTitle));
    }
    if (descriptionDraft.trim() !== (block.description ?? "").trim()) {
      ops.push(updateBlockDescription(block.id, descriptionDraft));
    }
    const results = await Promise.all(ops);
    setBusy(false);
    const failed = results.find((r) => !r.success) as
      | { success: false; error: string }
      | undefined;
    if (failed) {
      setError(failed.error);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  const btn =
    "rounded-xl border px-3 py-1.5 text-xs transition-colors disabled:opacity-50";
  const editControls = editing ? (
    <>
      <button
        type="button"
        onClick={save}
        disabled={busy}
        className={`${btn} border-neutral-200 bg-neutral-100 text-neutral-900 hover:bg-neutral-50`}
      >
        {busy ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        onClick={cancel}
        disabled={busy}
        className={`${btn} border-neutral-700 text-neutral-200 hover:bg-neutral-900`}
      >
        Cancel
      </button>
    </>
  ) : (
    <button
      type="button"
      onClick={startEdit}
      className={`${btn} border-neutral-700 text-neutral-200 hover:bg-neutral-900`}
    >
      Edit
    </button>
  );

  // Papers get their own detail view (title-first, abstract + owner-only full
  // text, explicit edit mode) - see PaperDetail.
  if (block.kind === "paper") {
    return <PaperDetail block={block} inModal={inModal} />;
  }
  return (
    <div
      className={
        inModal
          ? "relative grid grid-cols-1 gap-8 px-8 py-8 md:grid-cols-[1fr_24rem] md:gap-x-[76px]"
          : "relative grid h-full grid-cols-1 gap-8 px-8 py-8 md:grid-cols-[1fr_24rem] md:gap-x-[76px]"
      }
    >
      {/* Left column - title + description on top, then image/text, URL, reader.
          Two columns on md+ (image/title left, connections right); stacks on
          mobile. In the modal the same grid keeps the popup horizontal. */}
      <div className="flex flex-col gap-4">
        <header className={inModal ? "pr-10" : ""}>
          {editing ? (
            <input
              type="text"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              disabled={busy}
              className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-2xl font-light leading-tight text-neutral-100 outline-none focus:ring-1 focus:ring-neutral-500"
            />
          ) : (
            <h1 className="text-2xl font-light leading-tight text-neutral-100">
              {block.title || "Untitled"}
            </h1>
          )}
          {editing ? (
            <textarea
              value={descriptionDraft}
              onChange={(e) => setDescriptionDraft(e.target.value)}
              disabled={busy}
              rows={4}
              placeholder="Add a description…"
              className="mt-2 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm leading-relaxed text-neutral-200 outline-none focus:ring-1 focus:ring-neutral-500"
            />
          ) : block.description && block.kind !== "text" ? (
            <p className="mt-1 text-neutral-400">{block.description}</p>
          ) : !block.description ? (
            <p className="mt-1 text-neutral-600">No description</p>
          ) : null}
        </header>

        <div className="flex flex-1 items-start justify-start">
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
            <article className="prose prose-invert max-w-prose text-neutral-200 [&_a]:text-neutral-100 [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:border-l-2 [&_blockquote]:border-neutral-700 [&_blockquote]:pl-4 [&_blockquote]:italic [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-3 [&_ul]:list-disc [&_ul]:pl-5">
              <Markdown
                remarkPlugins={[remarkGfm]}
                components={{
                  img: (props) => (
                    // Rendered markdown image (e.g. pasted into the composer).
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      {...props}
                      alt={props.alt ?? ""}
                      className="my-4 max-h-[70vh] max-w-full rounded-lg"
                    />
                  ),
                  a: (props) => (
                    <a {...props} target="_blank" rel="noopener noreferrer" />
                  ),
                }}
              >
                {block.description}
              </Markdown>
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
            className="group flex items-center gap-2 self-start rounded-xl border border-neutral-800 bg-neutral-900/60 px-3 py-1.5 text-xs text-neutral-300 transition-colors hover:border-neutral-700 hover:bg-neutral-900"
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
          <details className="mt-2 rounded-xl border border-neutral-800 bg-neutral-950/60">
            <summary className="cursor-pointer select-none px-4 py-2 text-xs text-neutral-400 hover:text-neutral-200">
              Reader - page text saved at the time
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
        <dl className="space-y-1.5 text-xs">
          <div className="flex justify-between gap-4">
            <dt className="text-neutral-500">Added</dt>
            <dd className="text-neutral-300">
              {relativeTime(block.created_at)}
            </dd>
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
          extra={editControls}
        />
        {error && <p className="text-xs text-red-400">{error}</p>}

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
                ? "-"
                : relativeTime(block.created_at)}
            </span>
          </div>
          {block.channels.length === 0 ? (
            <p className="text-neutral-600">No channels yet.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {block.channels.map((c) => (
                <ChannelChip key={c.id} slug={c.slug} title={c.title} />
              ))}
            </div>
          )}
        </div>

        <BlockConnections
          blockId={block.id}
          initial={block.connected_blocks.map((b) => ({
            id: b.id,
            title: b.title,
            image_url: b.image_url,
            kind: b.kind,
            description: b.description,
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
