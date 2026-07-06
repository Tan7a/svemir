"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { bulkImportBookmarks } from "@/app/admin/actions";
import type { ParsedBookmark } from "@/lib/bookmarks-parser";

type ParseResponse = {
  totalBookmarks: number;
  folders: { path: string[]; key: string; count: number }[];
  bookmarks: ParsedBookmark[];
};

type Status =
  | { kind: "idle" }
  | { kind: "parsing" }
  | { kind: "previewing"; data: ParseResponse }
  | { kind: "importing" }
  | { kind: "done"; inserted: number; skipped: number }
  | { kind: "error"; message: string };

export default function ImportForm({
  onManage,
}: {
  /** Inline mode (admin overlay): jump to the Manage tab after an import. */
  onManage?: () => void;
} = {}) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [excludedFolders, setExcludedFolders] = useState<Set<string>>(new Set());

  async function handleFile(file: File) {
    setStatus({ kind: "parsing" });
    setExcludedFolders(new Set());
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/parse-bookmarks", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus({ kind: "error", message: data.error ?? "Parse failed" });
        return;
      }
      setStatus({ kind: "previewing", data });
    } catch (e) {
      setStatus({
        kind: "error",
        message: e instanceof Error ? e.message : "Upload failed",
      });
    }
  }

  function toggleFolder(key: string) {
    setExcludedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const filteredCount = useMemo(() => {
    if (status.kind !== "previewing") return 0;
    return status.data.bookmarks.filter((b) => {
      const key = b.folderPath.join("/");
      for (const ex of excludedFolders) {
        if (key === ex || key.startsWith(ex + "/")) return false;
      }
      return true;
    }).length;
  }, [status, excludedFolders]);

  async function handleImport() {
    if (status.kind !== "previewing") return;
    const filtered = status.data.bookmarks.filter((b) => {
      const key = b.folderPath.join("/");
      for (const ex of excludedFolders) {
        if (key === ex || key.startsWith(ex + "/")) return false;
      }
      return true;
    });
    setStatus({ kind: "importing" });
    const result = await bulkImportBookmarks(filtered);
    if (result.success) {
      setStatus({
        kind: "done",
        inserted: result.inserted,
        skipped: result.skipped,
      });
    } else {
      setStatus({ kind: "error", message: result.error });
    }
  }

  if (status.kind === "idle" || status.kind === "parsing" || status.kind === "error") {
    return (
      <div className="space-y-4">
        <label className="block">
          <div className="cursor-pointer rounded-2xl border-2 border-dashed border-neutral-700 bg-neutral-900 p-10 text-center hover:border-neutral-500">
            <p className="text-sm font-medium text-neutral-200">
              {status.kind === "parsing"
                ? "Parsing…"
                : "Click to choose a bookmarks .html file"}
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              Or drag & drop the file here
            </p>
          </div>
          <input
            type="file"
            accept=".html,text/html"
            className="hidden"
            disabled={status.kind === "parsing"}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
        </label>
        {status.kind === "error" && (
          <p className="text-sm text-red-400">{status.message}</p>
        )}
      </div>
    );
  }

  if (status.kind === "previewing") {
    const { totalBookmarks, folders } = status.data;
    return (
      <div className="space-y-5">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <p className="text-sm text-neutral-200">
            Found <strong>{totalBookmarks}</strong> bookmarks across{" "}
            <strong>{folders.length}</strong> folders.
          </p>
          <p className="mt-1 text-sm text-neutral-400">
            <strong>{filteredCount}</strong> will be imported with the current
            folder selection.
          </p>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium text-neutral-300">
              Folders ({folders.length})
            </h2>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setExcludedFolders(new Set())}
                className="text-xs text-neutral-500 hover:text-neutral-100"
              >
                Select all
              </button>
              <span className="text-neutral-700">·</span>
              <button
                type="button"
                onClick={() =>
                  setExcludedFolders(new Set(folders.map((f) => f.key)))
                }
                className="text-xs text-neutral-500 hover:text-neutral-100"
              >
                Deselect all
              </button>
            </div>
          </div>
          <div className="max-h-96 overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-900">
            <ul className="divide-y divide-neutral-800">
              {folders.map((f) => {
                const checked = !excludedFolders.has(f.key);
                const indent = (f.path.length - 1) * 16;
                return (
                  <li key={f.key}>
                    <label className="flex cursor-pointer items-center gap-3 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-800">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleFolder(f.key)}
                      />
                      <span style={{ paddingLeft: indent }} className="flex-1">
                        {f.path[f.path.length - 1]}
                        <span className="ml-2 text-xs text-neutral-500">
                          {f.path.slice(0, -1).join(" / ")}
                        </span>
                      </span>
                      <span className="text-xs text-neutral-500">{f.count}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleImport}
            disabled={filteredCount === 0}
            className="rounded-xl bg-neutral-100 px-5 py-2.5 text-sm font-medium text-neutral-900 hover:bg-neutral-50 disabled:opacity-50"
          >
            Import {filteredCount} bookmarks
          </button>
          <button
            type="button"
            onClick={() => setStatus({ kind: "idle" })}
            className="rounded-xl px-3 py-2.5 text-sm text-neutral-400 hover:text-neutral-100"
          >
            Cancel
          </button>
        </div>
        <p className="text-xs text-neutral-500">
          Existing URLs (already in the archive) will be skipped automatically.
          Folder names become channels. No images or descriptions are scraped at
          this stage - use the Manage page to fill those in.
        </p>
      </div>
    );
  }

  if (status.kind === "importing") {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-8 text-center">
        <p className="text-sm text-neutral-200">
          Importing… (this may take 10-60 seconds for large batches)
        </p>
      </div>
    );
  }

  if (status.kind === "done") {
    return (
      <div className="space-y-3 rounded-xl border border-neutral-800 bg-neutral-900 p-6">
        <h2 className="text-lg font-light text-neutral-100">Import complete</h2>
        <p className="text-sm text-neutral-300">
          ✓ Inserted <strong>{status.inserted}</strong> new bookmarks
          {status.skipped > 0 && (
            <>
              {" "}· skipped <strong>{status.skipped}</strong> already in archive
            </>
          )}
          .
        </p>
        <div className="flex gap-2 pt-2">
          {onManage && (
            <button
              type="button"
              onClick={onManage}
              className="rounded-xl bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-50"
            >
              Manage imported items
            </button>
          )}
          <Link
            href="/"
            className="rounded-xl border border-neutral-700 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
          >
            View archive
          </Link>
          <button
            type="button"
            onClick={() => setStatus({ kind: "idle" })}
            className="rounded-xl px-4 py-2 text-sm text-neutral-400 hover:text-neutral-100"
          >
            Import another file
          </button>
        </div>
      </div>
    );
  }

  return null;
}
