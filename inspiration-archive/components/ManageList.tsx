"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import type { ItemWithChannels } from "@/lib/types";
import {
  CATEGORIES,
  CATEGORY_PILL_CLASSES,
  colorForTag,
} from "@/lib/constants";
import {
  bulkDeleteItems,
  deleteItem,
  scrapeAndUpdateItem,
  scrapeMissingMetadata,
  updateItemTagsAndCategories,
} from "@/app/admin/actions";
import ConnectPicker from "@/components/ConnectPicker";

type Props = {
  items: ItemWithChannels[];
  page: number;
  totalPages: number;
  query: string;
  view: "list" | "grid";
};

export default function ManageList({
  items,
  page,
  totalPages,
  query,
  view,
}: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [editChannelIds, setEditChannelIds] = useState<string[]>([]);
  const [editCategories, setEditCategories] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(query);
  const [scraping, setScraping] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<{
    scraped: number;
    failed: number;
    remaining: number | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelected(new Set());
    setEditing(null);
  }, [page, query, view]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function startEdit(item: ItemWithChannels) {
    setEditing(item.id);
    setEditChannelIds(item.channels.map((c) => c.id));
    setEditCategories([...item.categories]);
  }

  function cancelEdit() {
    setEditing(null);
  }

  async function saveEdit() {
    if (!editing) return;
    setBusy(editing);
    const r1 = await updateItemChannels(editing, editChannelIds);
    if (!r1.success) {
      setError(r1.error);
      setBusy(null);
      return;
    }
    const r2 = await updateItemCategories(editing, editCategories);
    setBusy(null);
    if (!r2.success) {
      setError(r2.error);
      return;
    }
    setEditing(null);
    router.refresh();
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
    if (!confirm(`Delete ${selected.size} items? This cannot be undone.`))
      return;
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
      .filter((i) => !i.image_url || !i.description)
      .slice(0, 10);
    if (targets.length === 0) return;
    setScraping(true);
    for (const item of targets) {
      try {
        await scrapeAndUpdateItem(item.id, item.url);
      } catch {
        // ignore one-off failures
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

  function go(toPage: number) {
    const sp = new URLSearchParams();
    if (toPage > 1) sp.set("page", String(toPage));
    if (query) sp.set("q", query);
    if (view === "grid") sp.set("view", "grid");
    const qs = sp.toString();
    router.push(`/admin/manage${qs ? "?" + qs : ""}`);
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const sp = new URLSearchParams();
    if (searchInput.trim()) sp.set("q", searchInput.trim());
    if (view === "grid") sp.set("view", "grid");
    const qs = sp.toString();
    router.push(`/admin/manage${qs ? "?" + qs : ""}`);
  }

  function switchView(next: "list" | "grid") {
    if (next === view) return;
    const sp = new URLSearchParams();
    if (query) sp.set("q", query);
    if (next === "grid") sp.set("view", "grid");
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
            className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-white"
          >
            Search
          </button>
          {query && (
            <button
              type="button"
              onClick={() => router.push("/admin/manage")}
              className="text-sm text-zinc-500 hover:text-zinc-900"
            >
              Clear
            </button>
          )}
        </form>
        <button
          type="button"
          onClick={handleScrapeMissing}
          disabled={scraping || backfilling}
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm hover:bg-zinc-50 disabled:opacity-50"
          title="Fetch missing image/description for up to 10 items on this page"
        >
          {scraping ? "Scraping…" : "Scrape missing (10)"}
        </button>
        <button
          type="button"
          onClick={handleBackfillAll}
          disabled={scraping || backfilling}
          className="rounded-md border border-zinc-900 bg-zinc-900 px-3 py-2 text-sm text-white hover:bg-zinc-800 disabled:opacity-50"
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
      </div>
      {backfillProgress && !backfilling && (
        <p className="text-xs text-zinc-500">
          Backfill complete · {backfillProgress.scraped} scraped ·{" "}
          {backfillProgress.failed} failed
        </p>
      )}

      {view === "grid" && items.length > 0 && (
        <div className="flex items-center gap-3 text-xs text-zinc-600">
          <span>
            {items.length} item{items.length === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            onClick={() => {
              if (selected.size === items.length) setSelected(new Set());
              else setSelected(new Set(items.map((i) => i.id)));
            }}
            className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 hover:bg-zinc-50"
          >
            {selected.size === items.length && items.length > 0
              ? "Deselect all"
              : "Select all"}
          </button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm text-white">
          <span>{selected.size} selected</span>
          <button
            type="button"
            onClick={handleBulkDelete}
            disabled={busy === "bulk"}
            className="rounded-md bg-red-500 px-3 py-1 text-xs font-medium hover:bg-red-600 disabled:opacity-50"
          >
            {busy === "bulk" ? "Deleting…" : "Delete"}
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-xs text-zinc-300 hover:text-white"
          >
            Clear
          </button>
        </div>
      )}

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {view === "list" && (
        <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-xs text-zinc-500">
              <tr>
                <th className="w-10 p-3 text-left">
                  <input
                    type="checkbox"
                    checked={
                      selected.size === items.length && items.length > 0
                    }
                    onChange={() => {
                      if (selected.size === items.length)
                        setSelected(new Set());
                      else setSelected(new Set(items.map((i) => i.id)));
                    }}
                  />
                </th>
                <th className="p-3 text-left">Title</th>
                <th className="p-3 text-left w-64">Channels / Categories</th>
                <th className="p-3 text-right w-32">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {items.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-zinc-500">
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
                    className={isSelected ? "bg-zinc-50" : undefined}
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
                        <div className="h-12 w-16 shrink-0 overflow-hidden rounded bg-zinc-100">
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
                            href={`/item/${item.id}`}
                            className="line-clamp-2 font-medium text-zinc-900 hover:underline"
                          >
                            {item.title}
                          </Link>
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-0.5 line-clamp-1 text-xs text-zinc-500 hover:text-zinc-800"
                          >
                            {item.url}
                          </a>
                          {missing && (
                            <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
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
                                      ? "bg-zinc-900 text-white border-zinc-900"
                                      : "bg-white text-zinc-600 border-zinc-300"
                                  }`}
                                >
                                  {cat}
                                </button>
                              );
                            })}
                          </div>
                          <ConnectPicker
                            selected={editChannelIds}
                            onChange={setEditChannelIds}
                          />
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {item.categories.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {item.categories.map((c) => (
                                <span
                                  key={c}
                                  className={`rounded-full px-2 py-0.5 text-[10px] ${
                                    CATEGORY_PILL_CLASSES[c] ??
                                    "bg-zinc-200 text-zinc-700"
                                  }`}
                                >
                                  {c}
                                </span>
                              ))}
                            </div>
                          )}
                          {item.channels.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {item.channels.slice(0, 6).map((ch) => {
                                const c = colorForTag(ch.id);
                                return (
                                  <span
                                    key={ch.id}
                                    className={`rounded-full px-2 py-0.5 text-[10px] ${c.bg} ${c.text}`}
                                  >
                                    {ch.name}
                                  </span>
                                );
                              })}
                              {item.channels.length > 6 && (
                                <span className="text-[10px] text-zinc-500">
                                  +{item.channels.length - 6}
                                </span>
                              )}
                            </div>
                          )}
                          {item.categories.length === 0 &&
                            item.channels.length === 0 && (
                              <span className="text-xs text-zinc-400">
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
                            className="rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
                          >
                            {busy === item.id ? "…" : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => startEdit(item)}
                            className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs hover:bg-zinc-50"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(item.id)}
                            disabled={busy === item.id}
                            className="rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
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
      )}

      {view === "grid" && (
        <div>
          {items.length === 0 ? (
            <p className="rounded-xl border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-500">
              No items.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
              {items.map((item) => {
                const isSelected = selected.has(item.id);
                const visibleCategories = item.categories.slice(0, 2);
                const visibleChannels = item.channels.slice(0, 3);
                return (
                  <div key={item.id} className="group relative">
                    <Link href={`/item/${item.id}`} className="block">
                      <div
                        className={`relative aspect-[4/3] w-full overflow-hidden rounded-xl border-4 ${
                          isSelected ? "border-zinc-900" : "border-white"
                        } bg-white shadow-sm transition-shadow group-hover:shadow-lg`}
                      >
                        {item.image_url ? (
                          <Image
                            src={item.image_url}
                            alt={item.title}
                            fill
                            sizes="(min-width: 1280px) 20vw, (min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                            className="object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-100 to-zinc-200 text-zinc-400">
                            <span className="text-xs">No image</span>
                          </div>
                        )}
                      </div>
                    </Link>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleSelect(item.id);
                      }}
                      aria-label={isSelected ? "Deselect" : "Select"}
                      className={`absolute top-3 left-3 z-10 flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-semibold shadow-sm ${
                        isSelected
                          ? "bg-zinc-900 text-white border-zinc-900"
                          : "bg-white/95 text-zinc-400 border-white hover:text-zinc-900"
                      }`}
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleDelete(item.id);
                      }}
                      disabled={busy === item.id}
                      aria-label="Delete"
                      title="Delete"
                      className="absolute top-3 right-3 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-white/95 text-base leading-none text-red-600 shadow-sm border border-white/80 hover:bg-red-50 disabled:opacity-50"
                    >
                      {busy === item.id ? "…" : "×"}
                    </button>
                    <div className="mt-3 px-1">
                      {item.source_name && (
                        <p className="text-xs text-zinc-500">
                          {item.source_name}
                        </p>
                      )}
                      <h3 className="mt-0.5 text-sm font-medium text-zinc-900 line-clamp-2 leading-snug">
                        {item.title}
                      </h3>
                      {(visibleCategories.length > 0 ||
                        visibleChannels.length > 0) && (
                        <div className="mt-2 flex flex-wrap items-center gap-1">
                          {visibleCategories.map((cat) => (
                            <span
                              key={`c-${cat}`}
                              className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                                CATEGORY_PILL_CLASSES[cat] ??
                                "bg-zinc-200 text-zinc-700"
                              }`}
                            >
                              {cat}
                            </span>
                          ))}
                          {visibleChannels.map((ch) => {
                            const c = colorForTag(ch.id);
                            return (
                              <span
                                key={`ch-${ch.id}`}
                                className={`px-2 py-0.5 rounded-full text-[10px] ${c.bg} ${c.text}`}
                              >
                                {ch.name}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {totalPages > 1 && view === "list" && (
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => go(page - 1)}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm disabled:opacity-50"
          >
            ← Prev
          </button>
          <span className="text-sm text-zinc-600">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => go(page + 1)}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Next →
          </button>
        </div>
      )}
    </>
  );
}
