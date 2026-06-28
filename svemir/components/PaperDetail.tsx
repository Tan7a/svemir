"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ItemWithChannels } from "@/lib/types";
import { supabase } from "@/lib/supabase-client";
import { FACET_DIMENSIONS, FACET_DIMENSION_BY_KEY } from "@/lib/constants";
import BlockActions from "./BlockActions";
import BlockConnections from "./BlockConnections";
import PaperFullText from "./PaperFullText";
import { renameBlock, updateBlockDescription } from "@/app/admin/actions";

type Props = {
  block: ItemWithChannels;
  inModal?: boolean;
};

const DIMENSION_ORDER = FACET_DIMENSIONS.map((d) => d.key);

type FacetValue = { value: string; slug: string; count: number };
type FacetGroup = { dimension: string; values: FacetValue[] };

function relativeTime(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? "" : "s"} ago`;
  return `${Math.floor(mo / 12)} year${mo < 24 ? "" : "s"} ago`;
}

/**
 * Detail view for a paper (kind === "paper"). Unlike the generic BlockDetail it
 * leads with the title + authors + metadata, then the abstract and (owner-only)
 * full text — no image. An explicit Edit→Save mode toggles the title and
 * abstract into inputs; Save persists both and exits, surfacing any error (e.g.
 * "Not authorized" when signed out) instead of silently dropping the change.
 */
export default function PaperDetail({ block, inModal = false }: Props) {
  const router = useRouter();
  const authors = block.paper_authors ?? [];

  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(block.title);
  const [abstractDraft, setAbstractDraft] = useState(block.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facetGroups, setFacetGroups] = useState<FacetGroup[]>([]);

  // Facets are public (RLS select-using-true), so fetch them with the anon
  // client. Grouped by dimension in canonical order.
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase
      .from("paper_facet_links")
      .select("paper_facets(dimension, value, slug, paper_count)")
      .eq("paper_id", block.id)
      .then(({ data }) => {
        if (cancelled || !data) return;
        const rows = data
          .map((r) => {
            const pf = (r as { paper_facets: unknown }).paper_facets;
            return (Array.isArray(pf) ? pf[0] : pf) as
              | { dimension: string; value: string; slug: string; paper_count: number }
              | null;
          })
          .filter(Boolean) as {
          dimension: string;
          value: string;
          slug: string;
          paper_count: number;
        }[];
        const groups = DIMENSION_ORDER.map((dimension) => ({
          dimension,
          values: rows
            .filter((r) => r.dimension === dimension)
            .map((r) => ({ value: r.value, slug: r.slug, count: r.paper_count })),
        })).filter((g) => g.values.length > 0);
        setFacetGroups(groups);
      });
    return () => {
      cancelled = true;
    };
  }, [block.id]);

  function startEdit() {
    setTitleDraft(block.title);
    setAbstractDraft(block.description ?? "");
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
    if (abstractDraft.trim() !== (block.description ?? "").trim()) {
      ops.push(updateBlockDescription(block.id, abstractDraft));
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
    "rounded-md border px-3 py-1.5 text-xs transition-colors disabled:opacity-50";
  const editControls = editing ? (
    <>
      <button
        type="button"
        onClick={save}
        disabled={busy}
        className={`${btn} border-neutral-200 bg-neutral-100 text-neutral-900 hover:bg-white`}
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

  return (
    <div
      className={
        inModal
          ? "relative flex h-full flex-col gap-5 px-6 py-6"
          : "relative mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-3xl flex-col gap-5 px-6 py-8"
      }
    >
      {/* Header — title, authors, metadata (on top) */}
      <header className="flex flex-col gap-3">
        {editing ? (
          <input
            type="text"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            disabled={busy}
            className="w-full border-b border-neutral-500 bg-transparent text-2xl font-light leading-tight text-neutral-100 outline-none"
          />
        ) : (
          <h1 className="text-2xl font-light leading-tight text-neutral-100">
            {block.title || "Untitled"}
          </h1>
        )}

        {authors.length > 0 ? (
          <p className="text-sm text-neutral-400">{authors.join(", ")}</p>
        ) : (
          <p className="text-sm text-neutral-600">Authors unknown</p>
        )}

        <dl className="space-y-1.5 text-xs">
          <div className="flex justify-between gap-4">
            <dt className="text-neutral-500">Added</dt>
            <dd className="text-neutral-300">{relativeTime(block.created_at)}</dd>
          </div>
          {block.paper_year && (
            <div className="flex justify-between gap-4">
              <dt className="text-neutral-500">Year</dt>
              <dd className="text-neutral-300">{block.paper_year}</dd>
            </div>
          )}
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
      </header>

      {/* Action row — Connect | Actions | Edit/Save (Edit sits next to Actions) */}
      <BlockActions
        blockId={block.id}
        url={block.url}
        imageUrl={block.image_url}
        inModal={inModal}
        extra={editControls}
      />
      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* Abstract */}
      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-500">
          Abstract
        </h2>
        {editing ? (
          <textarea
            value={abstractDraft}
            onChange={(e) => setAbstractDraft(e.target.value)}
            disabled={busy}
            rows={8}
            className="w-full rounded-md border border-neutral-700 bg-neutral-950 p-3 text-[15px] leading-relaxed text-neutral-200 outline-none focus:ring-1 focus:ring-neutral-500"
          />
        ) : block.description ? (
          <p className="max-w-prose whitespace-pre-wrap text-[15px] leading-relaxed text-neutral-200">
            {block.description}
          </p>
        ) : (
          <p className="text-sm text-neutral-600">No abstract.</p>
        )}
      </section>

      {/* Facets — the 5-dimension network tags (public). */}
      {facetGroups.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Facets
          </h2>
          {facetGroups.map((g) => {
            const dim = FACET_DIMENSION_BY_KEY[g.dimension];
            return (
              <div key={g.dimension} className="flex flex-col gap-1.5">
                <span className="text-[10px] uppercase tracking-wide text-neutral-500">
                  {dim?.label ?? g.dimension}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {g.values.map((v) => (
                    <Link
                      key={v.slug}
                      href={`/facet/${v.slug}`}
                      title="See definition & all papers with this facet"
                      className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors hover:bg-neutral-900 ${dim?.border ?? "border-neutral-700"} ${dim?.text ?? "text-neutral-300"}`}
                    >
                      {v.value}
                      {v.count > 1 && (
                        <span className="ml-1 text-neutral-500">·{v.count}</span>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* Owner-only full text */}
      <PaperFullText blockId={block.id} />

      {/* Connections */}
      <div className="mt-2 border-b border-neutral-800">
        <span className="inline-block border-b-2 border-neutral-200 px-0 py-1.5 text-xs text-neutral-100">
          Connections{" "}
          <span className="ml-1 text-neutral-500">
            {block.channels.length + block.connected_blocks.length}
          </span>
        </span>
      </div>

      <div className="text-xs">
        <div className="mb-2 text-neutral-500">Channels</div>
        {block.channels.length === 0 ? (
          <p className="text-neutral-600">No channels yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {block.channels.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/channel/${c.slug}`}
                  className="text-neutral-200 hover:underline"
                >
                  {c.title}
                </Link>
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
          <Link href="/" className="text-xs text-neutral-500 hover:text-neutral-200">
            ← back to svemir
          </Link>
        </div>
      )}
    </div>
  );
}
