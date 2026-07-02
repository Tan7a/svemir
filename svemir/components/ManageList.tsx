"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ItemWithChannels } from "@/lib/types";
import { CATEGORIES } from "@/lib/constants";
import { supabase } from "@/lib/supabase-client";
import {
  backfillBlockConcepts,
  bulkDeleteItems,
  deleteItem,
  refetchScreenshotCovers,
  scrapeAndUpdateItem,
  scrapeMissingMetadata,
  updateItemChannelsAndCategories,
} from "@/app/admin/actions";

type Props = {
  items: ItemWithChannels[];
  page: number;
  totalPages: number;
  query: string;
};

export default function ManageList({ items, page, totalPages, query }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editCategories, setEditCategories] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [allTagNames, setAllTagNames] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(query);
  const [scraping, setScraping] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<{
    scraped: number;
    failed: number;
    remaining: number | null;
  } | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState<{
    processed: number;
    failed: number;
    remaining: number | null;
  } | null>(null);
  const [refetching, setRefetching] = useState(false);
  const [refetchProgress, setRefetchProgress] = useState<{
    scraped: number;
    failed: number;
    remaining: number | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase
      .from("channels")
      .select("title")
      .order("title")
      .then(({ data }) => {
        if (data) setAllTagNames(data.map((t) => t.title as string));
      });
  }, []);

  useEffect(() => {
    setSelected(new Set());
    setEditing(null);
  }, [page, query]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllOnPage() {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((i) => i.id)));
  }

  function startEdit(item: ItemWithChannels) {
    setEditing(item.id);
    setEditTags(item.channels.map((t) => t.title));
    setEditCategories([...item.categories]);
    setTagInput("");
  }

  function cancelEdit() {
    setEditing(null);
    setTagInput("");
  }

  async function saveEdit() {
    if (!editing) return;
    setBusy(editing);
    const r = await updateItemChannelsAndCategories(
      editing,
      editTags,
      editCategories
    );
    setBusy(null);
    if (r.success) {
      setEditing(null);
      router.refresh();
    } else {
      setError(r.error);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this item?")) return;
    setBusy(id);
    const r = await deleteItem(id);
    setBusy(null);
    if (r.success) {
      router.refresh();
    } else {
      setError(r.error);
    }
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} items? This cannot be undone.`)) return;
    setBusy("bulk");
    const r = await bulkDeleteItems([...selected]);
    setBusy(null);
    if (r.success) {
      setSelected(new Set());
      router.refresh();
    } else {
      setError(r.error);
    }
  }

  async function handleScrapeMissing() {
    const targets = items
      .filter((i) => i.url && (!i.image_url || !i.description))
      .slice(0, 10);
    if (targets.length === 0) return;
    setScraping(true);
    for (const item of targets) {
      if (!item.url) continue;
      try {
        await scrapeAndUpdateItem(item.id, item.url);
      } catch {
        // continue with the next one
      }
    }
    setScraping(false);
    router.refresh();
  }

  async function handleBackfillAll() {
    if (
      !confirm(
        "Backfill thumbnails for ALL items missing an image? This may take a few minutes."
      )
    )
      return;
    setBackfilling(true);
    setBackfillProgress({ scraped: 0, failed: 0, remaining: null });
    setError(null);

    let cursor: string | undefined;
    let totalScraped = 0;
    let totalFailed = 0;
    const MAX_BATCHES = 200;

    for (let i = 0; i < MAX_BATCHES; i++) {
      const r = await scrapeMissingMetadata(8, cursor);
      if (!r.success) {
        setError(r.error);
        break;
      }
      totalScraped += r.scraped;
      totalFailed += r.failed;
      setBackfillProgress({
        scraped: totalScraped,
        failed: totalFailed,
        remaining: r.remaining,
      });
      if (!r.lastId || r.remaining === 0) break;
      cursor = r.lastId;
    }

    setBackfilling(false);
    router.refresh();
  }

  async function handleRefetchCovers() {
    if (
      !confirm(
        "Replace old auto-captured screenshots with each page's own preview image (og:image)? This re-scrapes every link block that still has a screenshot cover and may take a few minutes."
      )
    )
      return;
    setRefetching(true);
    setRefetchProgress({ scraped: 0, failed: 0, remaining: null });
    setError(null);

    let cursor: string | undefined;
    let totalScraped = 0;
    let totalFailed = 0;
    const MAX_BATCHES = 200;

    for (let i = 0; i < MAX_BATCHES; i++) {
      const r = await refetchScreenshotCovers(8, cursor);
      if (!r.success) {
        setError(r.error);
        break;
      }
      totalScraped += r.scraped;
      totalFailed += r.failed;
      setRefetchProgress({
        scraped: totalScraped,
        failed: totalFailed,
        remaining: r.remaining,
      });
      if (!r.lastId || r.remaining === 0) break;
      cursor = r.lastId;
    }

    setRefetching(false);
    router.refresh();
  }

  async function handleExtractConcepts(force = false) {
    const message = force
      ? "Re-extract concepts for EVERY block? Use this after tuning — it rebuilds all concepts from scratch (locally, no AI) and may take a few minutes."
      : "Extract concepts for all blocks not yet indexed? This reads each block's text locally (no AI) and may take a few minutes.";
    if (!confirm(message)) return;
    setIndexing(true);
    setIndexProgress({ processed: 0, failed: 0, remaining: null });
    setError(null);

    let cursor: string | undefined;
    let totalProcessed = 0;
    let totalFailed = 0;
    const MAX_BATCHES = 500;

    for (let i = 0; i < MAX_BATCHES; i++) {
      const r = await backfillBlockConcepts(10, cursor, force);
      if (!r.success) {
        setError(r.error);
        break;
      }
      totalProcessed += r.processed;
      totalFailed += r.failed;
      setIndexProgress({
        processed: totalProcessed,
        failed: totalFailed,
        remaining: r.remaining,
      });
      if (!r.lastId || r.remaining === 0) break;
      cursor = r.lastId;
    }

    setIndexing(false);
    router.refresh();
  }

  function addTagChip(raw: string) {
    const name = raw.trim().toLowerCase();
    if (!name) return;
    if (editTags.some((t) => t.toLowerCase() === name)) {
      setTagInput("");
      return;
    }
    setEditTags((prev) => [...prev, name]);
    setTagInput("");
  }

  function removeTagChip(name: string) {
    setEditTags((prev) => prev.filter((t) => t !== name));
  }

  function toggleEditCategory(cat: string) {
    setEditCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  }

  const tagSuggestions = useMemo(() => {
    const q = tagInput.trim().toLowerCase();
    if (!q) return [];
    const used = new Set(editTags.map((t) => t.toLowerCase()));
    return allTagNames
      .filter((n) => n.toLowerCase().includes(q) && !used.has(n.toLowerCase()))
      .slice(0, 8);
  }, [tagInput, allTagNames, editTags]);

  function go(toPage: number) {
    const sp = new URLSearchParams();
    if (toPage > 1) sp.set("page", String(toPage));
    if (query) sp.set("q", query);
    const qs = sp.toString();
    router.push(`/admin/manage${qs ? "?" + qs : ""}`);
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const sp = new URLSearchParams();
    if (searchInput.trim()) sp.set("q", searchInput.trim());
    const qs = sp.toString();
    router.push(`/admin/manage${qs ? "?" + qs : ""}`);
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <form onSubmit={submitSearch} className="flex flex-1 min-w-[16rem] gap-2">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search title, description, URL…"
            className="flex-1 rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-xl bg-neutral-100 px-3 py-2 text-sm text-neutral-900"
          >
            Search
          </button>
          {query && (
            <button
              type="button"
              onClick={() => router.push("/admin/manage")}
              className="text-sm text-neutral-500 hover:text-neutral-100"
            >
              Clear
            </button>
          )}
        </form>
        <button
          type="button"
          onClick={handleScrapeMissing}
          disabled={scraping || backfilling || refetching}
          className="rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm hover:bg-neutral-800 disabled:opacity-50"
          title="Fetch missing image/description for up to 10 items on this page"
        >
          {scraping ? "Scraping…" : "Scrape missing (10)"}
        </button>
        <button
          type="button"
          onClick={handleBackfillAll}
          disabled={scraping || backfilling || indexing || refetching}
          className="rounded-xl border border-neutral-100 bg-neutral-100 px-3 py-2 text-sm text-neutral-900 hover:bg-white disabled:opacity-50"
          title="Scrape image/description for ALL items in the archive that are missing them"
        >
          {backfilling
            ? `Backfilling… ${backfillProgress?.scraped ?? 0} done${
                backfillProgress?.remaining != null
                  ? ` · ${backfillProgress.remaining} left`
                  : ""
              }`
            : "Backfill all thumbnails"}
        </button>
        <button
          type="button"
          onClick={handleRefetchCovers}
          disabled={scraping || backfilling || indexing || refetching}
          className="rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm hover:bg-neutral-800 disabled:opacity-50"
          title="Replace old screenshot covers with each page's own og:image"
        >
          {refetching
            ? `Re-fetching… ${refetchProgress?.scraped ?? 0} done${
                refetchProgress?.remaining != null
                  ? ` · ${refetchProgress.remaining} left`
                  : ""
              }`
            : "Re-fetch covers"}
        </button>
        <button
          type="button"
          onClick={() => handleExtractConcepts(false)}
          disabled={scraping || backfilling || indexing || refetching}
          className="rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm hover:bg-neutral-800 disabled:opacity-50"
          title="Extract concepts/terms (locally, no AI) for every block not yet indexed"
        >
          {indexing
            ? `Extracting… ${indexProgress?.processed ?? 0} done${
                indexProgress?.remaining != null
                  ? ` · ${indexProgress.remaining} left`
                  : ""
              }`
            : "Extract concepts"}
        </button>
        <button
          type="button"
          onClick={() => handleExtractConcepts(true)}
          disabled={scraping || backfilling || indexing || refetching}
          className="text-sm text-neutral-500 hover:text-neutral-200 disabled:opacity-50"
          title="Rebuild concepts for every block (use after tuning extraction)"
        >
          Re-extract all
        </button>
      </div>
      {backfillProgress && !backfilling && (
        <p className="text-xs text-neutral-500">
          Backfill complete · {backfillProgress.scraped} scraped ·{" "}
          {backfillProgress.failed} failed
        </p>
      )}
      {refetchProgress && !refetching && (
        <p className="text-xs text-neutral-500">
          {refetchProgress.scraped === 0 && refetchProgress.failed === 0
            ? "No screenshot covers to replace — nothing to do."
            : `Cover re-fetch complete · ${refetchProgress.scraped} replaced · ${refetchProgress.failed} skipped`}
        </p>
      )}
      {indexProgress && !indexing && (
        <p className="text-xs text-neutral-500">
          {indexProgress.processed === 0 && indexProgress.failed === 0
            ? "All blocks are already indexed — nothing to do."
            : `Concept extraction complete · ${indexProgress.processed} indexed · ${indexProgress.failed} failed`}
        </p>
      )}

      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-xl bg-neutral-100 px-4 py-2.5 text-sm text-neutral-900">
          <span>{selected.size} selected</span>
          <button
            type="button"
            onClick={handleBulkDelete}
            disabled={busy === "bulk"}
            className="rounded-xl bg-red-500 px-3 py-1 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-50"
          >
            {busy === "bulk" ? "Deleting…" : "Delete"}
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-xs text-neutral-600 hover:text-neutral-900"
          >
            Clear
          </button>
        </div>
      )}

      {error && (
        <p className="rounded-xl border border-red-900 bg-red-950 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="rounded-xl border border-neutral-800 bg-neutral-900 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-800 text-xs text-neutral-500">
            <tr>
              <th className="w-10 p-3 text-left">
                <input
                  type="checkbox"
                  checked={selected.size === items.length && items.length > 0}
                  onChange={selectAllOnPage}
                />
              </th>
              <th className="p-3 text-left">Title</th>
              <th className="p-3 text-left w-48">Categories / Tags</th>
              <th className="p-3 text-right w-32">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800">
            {items.length === 0 && (
              <tr>
                <td colSpan={4} className="p-6 text-center text-neutral-500">
                  No items.
                </td>
              </tr>
            )}
            {items.map((item) => {
              const isSelected = selected.has(item.id);
              const isEditing = editing === item.id;
              const missing = !item.image_url || !item.description;
              return (
                <tr
                  key={item.id}
                  className={isSelected ? "bg-neutral-800" : undefined}
                >
                  <td className="p-3 align-top">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(item.id)}
                    />
                  </td>
                  <td className="p-3">
                    <div className="flex items-start gap-3">
                      <div className="h-12 w-16 shrink-0 overflow-hidden rounded bg-neutral-800">
                        {item.image_url && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.image_url}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/block/${item.id}`}
                          className="line-clamp-2 font-medium text-neutral-100 hover:underline"
                        >
                          {item.title}
                        </Link>
                        {item.url && (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-0.5 line-clamp-1 text-xs text-neutral-500 hover:text-neutral-100"
                          >
                            {item.url}
                          </a>
                        )}
                        {missing && (
                          <span className="mt-1 inline-block rounded-full bg-amber-950 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                            no metadata yet
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="p-3 align-top">
                    {isEditing ? (
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-1">
                          {CATEGORIES.map((cat) => {
                            const active = editCategories.includes(cat);
                            return (
                              <button
                                key={cat}
                                type="button"
                                onClick={() => toggleEditCategory(cat)}
                                className={`px-2 py-0.5 rounded-full text-[10px] border ${
                                  active
                                    ? "bg-neutral-100 text-neutral-900 border-neutral-100"
                                    : "bg-neutral-900 text-neutral-400 border-neutral-700"
                                }`}
                              >
                                {cat}
                              </button>
                            );
                          })}
                        </div>
                        <div className="rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5">
                          <div className="flex flex-wrap items-center gap-1">
                            {editTags.map((t) => (
                              <span
                                key={t}
                                className="inline-flex items-center gap-1 rounded-full bg-neutral-800 px-2 py-0.5 text-[10px]"
                              >
                                {t}
                                <button
                                  type="button"
                                  onClick={() => removeTagChip(t)}
                                  className="text-neutral-500 hover:text-neutral-100"
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                            <input
                              type="text"
                              value={tagInput}
                              onChange={(e) => setTagInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === ",") {
                                  e.preventDefault();
                                  addTagChip(tagInput);
                                }
                              }}
                              placeholder="add tag…"
                              className="flex-1 min-w-[6rem] border-0 px-1 py-0.5 text-xs focus:outline-none"
                            />
                          </div>
                          {tagSuggestions.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1 border-t border-neutral-800 pt-1">
                              {tagSuggestions.map((s) => (
                                <button
                                  key={s}
                                  type="button"
                                  onClick={() => addTagChip(s)}
                                  className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-400 hover:bg-neutral-700"
                                >
                                  + {s}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {item.categories.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {item.categories.map((c) => (
                              <span
                                key={c}
                                className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px]"
                              >
                                {c}
                              </span>
                            ))}
                          </div>
                        )}
                        {item.channels.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {item.channels.slice(0, 6).map((t) => (
                              <span
                                key={t.id}
                                className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-300"
                              >
                                #{t.title}
                              </span>
                            ))}
                            {item.channels.length > 6 && (
                              <span className="text-[10px] text-neutral-500">
                                +{item.channels.length - 6}
                              </span>
                            )}
                          </div>
                        )}
                        {item.categories.length === 0 &&
                          item.channels.length === 0 && (
                            <span className="text-xs text-neutral-600">
                              none
                            </span>
                          )}
                      </div>
                    )}
                  </td>
                  <td className="p-3 align-top text-right">
                    {isEditing ? (
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={saveEdit}
                          disabled={busy === item.id}
                          className="rounded-xl bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-900 disabled:opacity-50"
                        >
                          {busy === item.id ? "…" : "Save"}
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          className="rounded-xl border border-neutral-700 px-2.5 py-1 text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => startEdit(item)}
                          className="rounded-xl border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-xs hover:bg-neutral-800"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(item.id)}
                          disabled={busy === item.id}
                          className="rounded-xl border border-red-900 bg-transparent px-2.5 py-1 text-xs text-red-400 hover:bg-red-950 disabled:opacity-50"
                        >
                          {busy === item.id ? "…" : "Delete"}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => go(page - 1)}
            className="rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm disabled:opacity-50"
          >
            ← Prev
          </button>
          <span className="text-sm text-neutral-400">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => go(page + 1)}
            className="rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Next →
          </button>
        </div>
      )}
    </>
  );
}
