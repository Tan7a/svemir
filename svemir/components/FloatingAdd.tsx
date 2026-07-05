"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { HINT_COOKIE } from "@/lib/access";
import {
  addItem,
  renameBlock,
  updateBlockDescription,
} from "@/app/admin/actions";
import { signOut } from "@/lib/access-actions";
import ChannelPicker from "./ChannelPicker";
import AdminForm from "./AdminForm";
import { supabase } from "@/lib/supabase-client";
import type { RecentChannel } from "@/lib/channels";

// TipTap pulls in ProseMirror - load it only on the client, only when needed.
const MarkdownEditor = dynamic(() => import("./MarkdownEditor"), {
  ssr: false,
  loading: () => (
    <div className="min-h-[52vh] text-sm text-neutral-600">Loading editor…</div>
  ),
});

// Admin sections that live on their own pages (heavier tools). Selecting one
// closes the composer and navigates there, so it isn't hidden behind the glass.
const ADMIN_SECTIONS = [
  { label: "Bulk import", href: "/admin/import" },
  { label: "Manage", href: "/admin/manage" },
  { label: "Tokens", href: "/admin/tokens" },
  { label: "Guestbook", href: "/admin/guestbook" },
];

// Event a text block's "Edit" dispatches to open this composer pre-filled.
export type EditTextDetail = { id: string; title: string; description: string };

// Event a paper's "Read full text" dispatches to open the same composer on the
// paper's (gated) full text, which saves back via PUT /api/papers/[id]/content.
export type EditPaperFullTextDetail = { id: string; title: string; text: string };

/**
 * Floating "+" quick-add, bottom-right, owner-only (readable HINT_COOKIE - the
 * real guard is isAuthed() in the server actions). Opens a full-screen,
 * Soba-style composer: the page behind goes dark + heavily blurred, and you
 * write in a WYSIWYG markdown editor (rendered bold/italic/headings/images - no
 * raw symbols). New notes save via addItem (kind:"text"); editing an existing
 * text block (opened via the "svemir:edit-text" event) saves via
 * updateBlockDescription/renameBlock. "More options" reveals the full admin hub.
 */

function hasHintCookie(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split("; ").some((c) => c === `${HINT_COOKIE}=1`);
}

export default function FloatingAdd() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // The garden view shows the Poet Engineer credit above the maker pill, so the
  // + lifts there to make room - but nowhere else.
  const viewParam = searchParams.get("view");
  const isGarden =
    pathname === "/graph" && (viewParam === null || viewParam === "garden");

  const [authed, setAuthed] = useState(false);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"text" | "more">("text");
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [channels, setChannels] = useState<string[]>([]);
  const [recents, setRecents] = useState<RecentChannel[]>([]);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );
  const [error, setError] = useState("");
  // Edit mode: the block being edited (null = composing a new note). mountKey
  // remounts the (uncontrolled) editor with fresh content each time we open.
  const [editId, setEditId] = useState<string | null>(null);
  // The paper whose full text is being edited (null = not a full-text edit).
  const [paperFtId, setPaperFtId] = useState<string | null>(null);
  const [editOrigTitle, setEditOrigTitle] = useState("");
  const [mountKey, setMountKey] = useState(0);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setAuthed(hasHintCookie()), []);

  // Auto-grow the title so long titles wrap onto new lines instead of truncating.
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [title, open, mountKey]);

  // Open pre-filled when a text block asks to be edited in the composer.
  useEffect(() => {
    function onEdit(ev: Event) {
      const d = (ev as CustomEvent<EditTextDetail>).detail;
      if (!d) return;
      setEditId(d.id);
      setPaperFtId(null);
      setEditOrigTitle(d.title ?? "");
      setTitle(d.title ?? "");
      setText(d.description ?? "");
      setSource("");
      setChannels([]);
      setError("");
      setStatus("idle");
      setView("text");
      setMountKey((k) => k + 1);
      setOpen(true);
    }
    window.addEventListener("svemir:edit-text", onEdit);
    return () => window.removeEventListener("svemir:edit-text", onEdit);
  }, []);

  // Open on a paper's full text (same composer), seeded with the fetched text.
  useEffect(() => {
    function onEditPaper(ev: Event) {
      const d = (ev as CustomEvent<EditPaperFullTextDetail>).detail;
      if (!d) return;
      setEditId(null);
      setPaperFtId(d.id);
      setEditOrigTitle(d.title ?? "");
      setTitle(d.title ?? "");
      setText(d.text ?? "");
      setSource("");
      setChannels([]);
      setError("");
      setStatus("idle");
      setView("text");
      setMountKey((k) => k + 1);
      setOpen(true);
    }
    window.addEventListener("svemir:edit-paper-fulltext", onEditPaper);
    return () =>
      window.removeEventListener("svemir:edit-paper-fulltext", onEditPaper);
  }, []);

  // Lock background scroll while open; close on Escape.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Recent channels for the picker's suggestions (blocks-style), newest first.
  useEffect(() => {
    if (!open || recents.length > 0 || !supabase) return;
    supabase
      .from("channels")
      .select("id,title,slug,created_at")
      .order("created_at", { ascending: false })
      .limit(14)
      .then(({ data }) => {
        if (data)
          setRecents(
            data.map((r) => ({
              id: r.id as string,
              title: r.title as string,
              slug: r.slug as string,
              block_count: 0,
              last_connected_at: (r.created_at as string) ?? null,
            }))
          );
      });
  }, [open, recents.length]);

  if (!authed) return null;

  function openNew() {
    setEditId(null);
    setPaperFtId(null);
    setEditOrigTitle("");
    setTitle("");
    setText("");
    setSource("");
    setChannels([]);
    setError("");
    setStatus("idle");
    setView("text");
    setMountKey((k) => k + 1);
    setOpen(true);
  }

  async function save() {
    const body = text.trim();
    if (!body) {
      setError("Write something first.");
      setStatus("error");
      return;
    }
    setStatus("saving");
    setError("");

    if (paperFtId) {
      // Editing a paper's full text: save the body via the gated PUT, and the
      // title via renameBlock if it changed. (The abstract lives elsewhere.)
      const res = await fetch(`/api/papers/${paperFtId}/content`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: body }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not save full text.");
        setStatus("error");
        return;
      }
      const nextTitle = title.trim();
      if (nextTitle && nextTitle !== editOrigTitle) {
        const r = await renameBlock(paperFtId, nextTitle);
        if (!r.success) {
          // The full text already saved above; only the title rename failed.
          setError(`Full text saved, but the title didn't update: ${r.error}`);
          setStatus("error");
          return;
        }
      }
      setStatus("saved");
      router.refresh();
      setTimeout(() => {
        setStatus("idle");
        setOpen(false);
      }, 600);
      return;
    }

    if (editId) {
      // Editing an existing text block: update title + description only.
      const ops: Promise<{ success: true } | { success: false; error: string }>[] =
        [];
      const nextTitle = title.trim();
      if (nextTitle && nextTitle !== editOrigTitle)
        ops.push(renameBlock(editId, nextTitle));
      ops.push(updateBlockDescription(editId, body));
      const results = await Promise.all(ops);
      const failed = results.find((r) => !r.success) as
        | { success: false; error: string }
        | undefined;
      if (failed) {
        setError(failed.error);
        setStatus("error");
        return;
      }
      setStatus("saved");
      router.refresh();
      setTimeout(() => {
        setStatus("idle");
        setOpen(false);
      }, 600);
      return;
    }

    // New note.
    const derived =
      title.trim() ||
      body.split("\n")[0].replace(/^[#>\-*\s]+/, "").slice(0, 60) ||
      "Untitled";
    const res = await addItem({
      kind: "text",
      url: "",
      title: derived,
      description: body,
      image_url: "",
      source_name: source.trim(),
      source_handle: "",
      source_type: source.trim() ? "book" : "website",
      categories: [],
      channelTitles: channels,
    });
    if (res.success) {
      setStatus("saved");
      router.refresh();
      setTimeout(() => {
        setStatus("idle");
        setOpen(false);
      }, 700);
    } else {
      setError(res.error);
      setStatus("error");
    }
  }

  async function logout() {
    await signOut();
    window.location.href = "/";
  }

  const isEditing = editId !== null;
  const isPaperFt = paperFtId !== null;

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/85 backdrop-blur-xl">
          {/* Top bar */}
          <div className="flex items-center gap-3 px-4 py-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-lg leading-none text-neutral-500 hover:text-neutral-200"
              aria-label="Close composer"
            >
              ×
            </button>

            {view === "text" ? (
              <>
                <div className="flex-1 text-center text-sm font-medium text-neutral-400">
                  {isPaperFt ? "Edit full text" : isEditing ? "Edit note" : "New note"}
                </div>
                <div className="flex items-center gap-3">
                  {status === "error" && (
                    <span className="text-xs text-rose-400">{error}</span>
                  )}
                  {status === "saved" && (
                    <span className="text-xs text-emerald-400">Saved</span>
                  )}
                  {!isEditing && !isPaperFt && (
                    <button
                      type="button"
                      onClick={() => setView("more")}
                      className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/10 hover:text-neutral-100"
                    >
                      More options
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={save}
                    disabled={status === "saving"}
                    className="rounded-lg bg-neutral-100 px-4 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-60"
                  >
                    {status === "saving" ? "Saving…" : "Save"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setView("text")}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/10 hover:text-neutral-100"
                >
                  ← Back to writing
                </button>
                <div className="flex-1 text-center text-sm font-medium text-neutral-300">
                  Manage
                </div>
                <button
                  type="button"
                  onClick={logout}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/10 hover:text-neutral-100"
                >
                  Log out
                </button>
              </>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {view === "text" ? (
              <div className="mx-auto w-full max-w-3xl px-6 pb-24 pt-6">
                <textarea
                  ref={titleRef}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.preventDefault(); // title stays one logical line
                  }}
                  placeholder="Untitled"
                  rows={1}
                  className="mb-6 w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-4xl font-bold leading-tight text-neutral-100 placeholder:text-neutral-700 focus:outline-none focus:ring-0"
                />

                {/* WYSIWYG markdown editor - rendered formatting, no raw symbols. */}
                <MarkdownEditor
                  key={mountKey}
                  initialValue={text}
                  onChange={setText}
                  placeholder="Start writing… paste a book quote, drop or paste an image."
                />

                {/* New notes get source + channels; editing just touches the note. */}
                {!isEditing && !isPaperFt && (
                  <div className="mt-10 space-y-4 border-t border-white/10 pt-6">
                    <input
                      value={source}
                      onChange={(e) => setSource(e.target.value)}
                      placeholder="Author / book (optional)"
                      className="w-full border-0 bg-transparent p-0 text-sm italic text-neutral-400 placeholder:text-neutral-700 focus:outline-none"
                    />
                    <div>
                      <div className="mb-2 text-xs uppercase tracking-wide text-neutral-600">
                        Channels
                      </div>
                      <ChannelPicker
                        value={channels}
                        onChange={setChannels}
                        recents={recents}
                      />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Full admin hub - opened in place. "Add one" is inline; the
                 heavier sections close the overlay and open their own page so
                 they're never hidden behind the glass. */
              <div className="mx-auto w-full max-w-2xl px-6 pb-24 pt-6">
                <div className="mb-6 flex flex-wrap justify-center gap-1">
                  <span className="rounded-full bg-neutral-100 px-3 py-1.5 text-sm text-neutral-900">
                    Add one
                  </span>
                  {ADMIN_SECTIONS.map((s) => (
                    <button
                      key={s.href}
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        router.push(s.href);
                      }}
                      className="rounded-full px-3 py-1.5 text-sm text-neutral-400 transition-colors hover:bg-neutral-900 hover:text-neutral-100"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                <AdminForm />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating + trigger, above the maker-credit pill. */}
      <button
        type="button"
        onClick={openNew}
        aria-label="Quick add"
        className={`fixed right-4 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-neutral-700 bg-neutral-900/90 text-xl text-neutral-200 backdrop-blur transition-colors hover:bg-neutral-800 hover:text-white ${
          isGarden ? "bottom-20" : "bottom-12"
        }`}
      >
        <span className="-mt-0.5 leading-none">+</span>
      </button>
    </>
  );
}
