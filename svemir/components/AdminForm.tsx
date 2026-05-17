"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { addItem } from "@/app/admin/actions";
import { CATEGORIES, SOURCE_TYPES } from "@/lib/constants";
import { supabase } from "@/lib/supabase-client";

type Kind = "link" | "image" | "text";

type Status =
  | { kind: "idle" }
  | { kind: "scraping" }
  | { kind: "saving" }
  | { kind: "uploading" }
  | { kind: "success" }
  | { kind: "error"; message: string };

const inputClass =
  "w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-500";

function looksLikeUrl(s: string): boolean {
  if (!s) return false;
  try {
    const u = new URL(s.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export default function AdminForm() {
  const [kind, setKind] = useState<Kind>("link");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [sourceHandle, setSourceHandle] = useState("");
  const [sourceType, setSourceType] = useState<string>("website");
  const [categories, setCategories] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [allTagNames, setAllTagNames] = useState<string[]>([]);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const lastFetchedUrl = useRef<string>("");
  const formRef = useRef<HTMLDivElement>(null);

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

  // Auto-fetch metadata when URL changes (debounced) — link kind only.
  useEffect(() => {
    if (kind !== "link") return;
    if (!looksLikeUrl(url)) return;
    if (url === lastFetchedUrl.current) return;
    if (status.kind === "scraping" || status.kind === "saving") return;
    if (title.trim() && imageUrl.trim()) return;

    const handle = setTimeout(() => {
      handleFetchMetadata(true);
    }, 500);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, kind]);

  // Cmd+Enter / Ctrl+Enter to save
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSave();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    kind,
    url,
    title,
    description,
    imageUrl,
    sourceName,
    sourceHandle,
    sourceType,
    categories,
    tags,
  ]);

  const suggestions = useMemo(() => {
    const q = tagInput.trim().toLowerCase();
    if (!q) return [];
    const used = new Set(tags.map((t) => t.toLowerCase()));
    return allTagNames
      .filter((n) => n.toLowerCase().includes(q) && !used.has(n.toLowerCase()))
      .slice(0, 8);
  }, [tagInput, allTagNames, tags]);

  function reset() {
    setUrl("");
    setTitle("");
    setDescription("");
    setImageUrl("");
    setSourceName("");
    setSourceHandle("");
    setSourceType("website");
    setCategories([]);
    setTags([]);
    setTagInput("");
    lastFetchedUrl.current = "";
  }

  function addTag(raw: string) {
    const name = raw.trim().toLowerCase();
    if (!name) return;
    if (tags.some((t) => t.toLowerCase() === name)) {
      setTagInput("");
      return;
    }
    setTags((prev) => [...prev, name]);
    setTagInput("");
  }

  function removeTag(name: string) {
    setTags((prev) => prev.filter((t) => t !== name));
  }

  function onTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(tagInput);
    } else if (e.key === "Backspace" && !tagInput && tags.length > 0) {
      setTags((prev) => prev.slice(0, -1));
    }
  }

  async function uploadImageBlob(blob: Blob): Promise<string | null> {
    setStatus({ kind: "uploading" });
    try {
      const fd = new FormData();
      fd.append("file", blob, "screenshot.png");
      const res = await fetch("/api/upload-image", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus({ kind: "error", message: data.error ?? "Upload failed" });
        return null;
      }
      setStatus({ kind: "idle" });
      return data.url as string;
    } catch (e) {
      setStatus({
        kind: "error",
        message: e instanceof Error ? e.message : "Upload failed",
      });
      return null;
    }
  }

  async function handleFormPaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of items) {
      if (it.type.startsWith("image/")) {
        e.preventDefault();
        const blob = it.getAsFile();
        if (!blob) continue;
        const url = await uploadImageBlob(blob);
        if (url) setImageUrl(url);
        return;
      }
    }
    // Otherwise: if URL field is empty and clipboard text looks like a URL, fill it.
    // Only relevant when we're showing the URL field.
    if (kind !== "link") return;
    const text = e.clipboardData?.getData("text/plain");
    if (!url.trim() && text && looksLikeUrl(text)) {
      setUrl(text.trim());
    }
  }

  async function handleFetchMetadata(silent = false) {
    if (!url.trim()) {
      if (!silent) setStatus({ kind: "error", message: "Enter a URL first" });
      return;
    }
    lastFetchedUrl.current = url;
    setStatus({ kind: "scraping" });
    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus({ kind: "error", message: data.error ?? "Failed to scrape" });
        return;
      }
      if (data.title && !title.trim()) setTitle(data.title);
      if (data.description && !description.trim()) setDescription(data.description);
      if (data.image && !imageUrl.trim()) setImageUrl(data.image);
      if (data.siteName && !sourceName.trim()) setSourceName(data.siteName);
      if (data.sourceType) setSourceType(data.sourceType);
      setStatus({ kind: "idle" });
    } catch (e) {
      setStatus({
        kind: "error",
        message: e instanceof Error ? e.message : "Failed to scrape",
      });
    }
  }

  async function handleSave() {
    if (!title.trim()) {
      setStatus({ kind: "error", message: "Title is required" });
      return;
    }
    if (kind === "link" && !url.trim()) {
      setStatus({ kind: "error", message: "URL is required for link blocks" });
      return;
    }
    if (kind === "image" && !imageUrl.trim()) {
      setStatus({
        kind: "error",
        message: "Image URL is required for image blocks (paste a screenshot or paste a URL)",
      });
      return;
    }
    if (kind === "text" && !description.trim()) {
      setStatus({ kind: "error", message: "Text content is required for text blocks" });
      return;
    }

    setStatus({ kind: "saving" });
    const result = await addItem({
      kind,
      url,
      title,
      description,
      image_url: imageUrl,
      source_name: sourceName,
      source_handle: sourceHandle,
      source_type: sourceType,
      categories,
      channelTitles: tags,
    });
    if (result.success) {
      const justAdded = [...tags];
      reset();
      setStatus({ kind: "success" });
      setAllTagNames((prev) => {
        const set = new Set(prev);
        justAdded.forEach((t) => set.add(t));
        return [...set].sort();
      });
    } else {
      setStatus({ kind: "error", message: result.error });
    }
  }

  function toggleCategory(cat: string) {
    setCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  }

  const showUrl = kind === "link";
  const showImage = kind === "link" || kind === "image";
  const showSource = kind === "link";
  // For text blocks, the description IS the content — give it more room.
  const descriptionRows = kind === "text" ? 10 : 3;
  const descriptionLabel = kind === "text" ? "Text" : "Description";

  return (
    <div ref={formRef} onPaste={handleFormPaste} className="space-y-5">
      <div className="flex items-center gap-1 rounded-md border border-neutral-800 bg-neutral-900 p-1 text-xs">
        {(["link", "image", "text"] as const).map((k) => {
          const active = kind === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`flex-1 rounded px-3 py-1.5 capitalize transition-colors ${
                active
                  ? "bg-neutral-100 text-neutral-900"
                  : "text-neutral-400 hover:text-neutral-100"
              }`}
            >
              {k}
            </button>
          );
        })}
      </div>

      <p className="text-xs text-neutral-500">
        {kind === "link" && (
          <>
            Paste a URL → metadata fills automatically. Paste a screenshot →
            uploads as the image. Press{" "}
            <kbd className="rounded bg-neutral-800 px-1 text-neutral-300">⌘ Enter</kbd>{" "}
            to save.
          </>
        )}
        {kind === "image" && (
          <>
            Paste a screenshot anywhere to upload it, or paste an image URL.
            Press{" "}
            <kbd className="rounded bg-neutral-800 px-1 text-neutral-300">⌘ Enter</kbd>{" "}
            to save.
          </>
        )}
        {kind === "text" && (
          <>
            A text-only block — title plus a body of text. Press{" "}
            <kbd className="rounded bg-neutral-800 px-1 text-neutral-300">⌘ Enter</kbd>{" "}
            to save.
          </>
        )}
      </p>

      {showUrl && (
        <div>
          <label className="mb-1 block text-sm font-medium text-neutral-300">
            URL
          </label>
          <div className="flex gap-2">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
              className={inputClass}
              autoFocus
            />
            <button
              type="button"
              onClick={() => handleFetchMetadata(false)}
              disabled={status.kind === "scraping"}
              className="shrink-0 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-60"
              title="Re-fetch metadata"
            >
              {status.kind === "scraping" ? "Fetching…" : "↻"}
            </button>
          </div>
        </div>
      )}

      <div>
        <label className="mb-1 block text-sm font-medium text-neutral-300">
          Title
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-neutral-300">
          {descriptionLabel}
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={descriptionRows}
          className={inputClass}
        />
      </div>

      {showImage && (
        <div>
          <label className="mb-1 block text-sm font-medium text-neutral-300">
            Image
          </label>
          <div className="flex gap-2">
            <input
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://… or paste a screenshot anywhere on this page"
              className={inputClass}
            />
            {imageUrl && (
              <button
                type="button"
                onClick={() => setImageUrl("")}
                className="shrink-0 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800"
              >
                Clear
              </button>
            )}
          </div>
          {imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt=""
              className="mt-2 h-32 w-auto rounded-md border border-neutral-800 object-cover"
            />
          )}
          {status.kind === "uploading" && (
            <p className="mt-1 text-xs text-neutral-500">Uploading screenshot…</p>
          )}
        </div>
      )}

      {showSource && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-300">
                Source name
              </label>
              <input
                type="text"
                value={sourceName}
                onChange={(e) => setSourceName(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-300">
                Source handle (optional)
              </label>
              <input
                type="text"
                value={sourceHandle}
                onChange={(e) => setSourceHandle(e.target.value)}
                placeholder="@username"
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-300">
              Source type
            </label>
            <select
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value)}
              className={inputClass}
            >
              {SOURCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      <div>
        <label className="mb-2 block text-sm font-medium text-neutral-300">
          Categories
        </label>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((cat) => {
            const active = categories.includes(cat);
            return (
              <button
                key={cat}
                type="button"
                onClick={() => toggleCategory(cat)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "border-neutral-100 bg-neutral-100 text-neutral-900"
                    : "border-neutral-700 bg-transparent text-neutral-300 hover:border-neutral-500"
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-neutral-300">
          Channels
        </label>
        <div className="rounded-md border border-neutral-700 bg-neutral-900 p-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {tags.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 rounded-full bg-neutral-800 px-2.5 py-1 text-xs text-neutral-200"
              >
                {t}
                <button
                  type="button"
                  onClick={() => removeTag(t)}
                  className="text-neutral-500 hover:text-neutral-200"
                  aria-label={`Remove ${t}`}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={onTagKeyDown}
              onBlur={() => addTag(tagInput)}
              placeholder={
                tags.length === 0 ? "Type a channel and press Enter…" : ""
              }
              className="min-w-[8rem] flex-1 border-0 bg-transparent px-1 py-1 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none"
            />
          </div>
          {suggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5 border-t border-neutral-800 pt-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => addTag(s)}
                  className="rounded-full bg-neutral-800 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
                >
                  + {s}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={status.kind === "saving"}
          className="rounded-md bg-neutral-100 px-5 py-2 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-60"
        >
          {status.kind === "saving" ? "Saving…" : "Save"}
        </button>
        {status.kind === "success" && (
          <span className="text-sm text-emerald-400">Saved.</span>
        )}
        {status.kind === "error" && (
          <span className="text-sm text-red-400">{status.message}</span>
        )}
      </div>
    </div>
  );
}
