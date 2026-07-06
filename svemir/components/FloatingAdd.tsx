"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuthed } from "@/lib/use-authed";
import {
  addItem,
  renameBlock,
  updateBlockDescription,
  listItems,
} from "@/app/admin/actions";
import { listTokens, type TokenRow } from "@/app/admin/tokens/actions";
import {
  listGuestbookEntries,
  type AdminEntry,
} from "@/app/admin/guestbook/actions";
import { signOut } from "@/lib/access-actions";
import ChannelPicker from "./ChannelPicker";
import AdminForm from "./AdminForm";
import ImportForm from "./ImportForm";
import ManageList from "./ManageList";
import TokensClient from "@/app/admin/tokens/TokensClient";
import GuestbookAdminList from "./GuestbookAdminList";
import SignInModal from "./SignInModal";
import { MenuPanel, MenuItem, MenuDivider } from "./ui/Menu";
import { supabase } from "@/lib/supabase-client";
import type { RecentChannel } from "@/lib/channels";
import type { ItemWithChannels } from "@/lib/types";

// TipTap pulls in ProseMirror - load it only on the client, only when needed.
const MarkdownEditor = dynamic(() => import("./MarkdownEditor"), {
  ssr: false,
  loading: () => (
    <div className="min-h-[52vh] text-sm text-neutral-600">Loading editor…</div>
  ),
});

// The admin hub tabs, all rendered inline inside this one overlay (no route
// change). This overlay is the only admin surface now - the old standalone
// /admin/* pages were retired.
const MANAGE_TABS = [
  { id: "add", label: "Add one" },
  { id: "import", label: "Bulk import" },
  { id: "manage", label: "Manage" },
  { id: "tokens", label: "Tokens" },
  { id: "guestbook", label: "Guestbook" },
] as const;

type ManageTab = (typeof MANAGE_TABS)[number]["id"];

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
 *
 * The + is ALWAYS visible: signed out, it opens the sign-in popup (so the owner
 * can always get back in); signed in, it opens the composer. The addItem action
 * re-checks real auth server-side regardless.
 */

export default function FloatingAdd() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // The garden view shows the Poet Engineer credit above the maker pill, so the
  // + lifts there to make room - but nowhere else.
  const viewParam = searchParams.get("view");
  const isGarden =
    pathname === "/graph" && (viewParam === null || viewParam === "garden");

  const authed = useAuthed();
  const [signInOpen, setSignInOpen] = useState(false);
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

  // The floating "+" menu (Write / Manage / Onboarding / Log out).
  const [menuOpen, setMenuOpen] = useState(false);
  const menuWrapRef = useRef<HTMLDivElement>(null);

  // Which admin-hub tab is showing in the "more" view.
  const [manageTab, setManageTab] = useState<ManageTab>("add");
  // Lazily-loaded data for the three heavier tabs (null = not fetched yet).
  const [tokens, setTokens] = useState<TokenRow[] | null>(null);
  const [entries, setEntries] = useState<AdminEntry[] | null>(null);
  const [manage, setManage] = useState<{
    items: ItemWithChannels[];
    page: number;
    totalPages: number;
    query: string;
  } | null>(null);
  const [tabError, setTabError] = useState<string | null>(null);

  async function loadTokens() {
    setTabError(null);
    const r = await listTokens();
    if ("error" in r) setTabError(r.error);
    else setTokens(r.tokens);
  }

  async function loadGuestbook() {
    setTabError(null);
    const r = await listGuestbookEntries();
    if ("error" in r) setTabError(r.error);
    else setEntries(r.entries);
  }

  async function loadManage(next?: { page?: number; q?: string }) {
    const page = next?.page ?? manage?.page ?? 1;
    const q = next?.q ?? manage?.query ?? "";
    setTabError(null);
    const r = await listItems({ page, q });
    if ("error" in r) setTabError(r.error);
    else setManage({ ...r, query: q });
  }

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

  // Lazy-load a heavy tab's data the first time it's shown in the manage view.
  // (Fetching data on view is a legitimate effect - synchronizing with the
  // server, which the load fns own.)
  useEffect(() => {
    if (!open || view !== "more") return;
    const load =
      manageTab === "tokens" && tokens === null
        ? loadTokens
        : manageTab === "guestbook" && entries === null
          ? loadGuestbook
          : manageTab === "manage" && manage === null
            ? loadManage
            : null;
    load?.();
    // Deps are intentionally narrow: the null-checks above make the loaders
    // idempotent, so re-running on data/loader identity changes isn't needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, view, manageTab]);

  // Close the "+" menu on outside-click or Escape (mirrors the sort/brand menus).
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuWrapRef.current && !menuWrapRef.current.contains(e.target as Node))
        setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // "Add block" (BrandMark context menu) opens the same composer as the +,
  // enforcing auth the same way (sign-in popup when signed out).
  useEffect(() => {
    function onOpen() {
      if (authed) openNew();
      else setSignInOpen(true);
    }
    window.addEventListener("svemir:open-composer", onOpen);
    return () => window.removeEventListener("svemir:open-composer", onOpen);
  }, [authed]);

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

  // Open the overlay straight into the admin hub (Manage view, first tab).
  function openManage() {
    openNew();
    setManageTab("add");
    setView("more");
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
                  <button
                    type="button"
                    onClick={save}
                    disabled={status === "saving"}
                    className="rounded-lg bg-neutral-100 px-4 py-1.5 text-sm font-medium text-neutral-900 hover:bg-neutral-50 disabled:opacity-60"
                  >
                    {status === "saving" ? "Saving…" : "Save"}
                  </button>
                </div>
              </>
            ) : (
              <>
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
              /* Full admin hub - every tab rendered inline in this one overlay,
                 switched by state (no route change). */
              <div className="mx-auto w-full max-w-5xl px-6 pb-24 pt-6">
                <div className="mb-6 flex flex-wrap justify-center gap-1">
                  {MANAGE_TABS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        setTabError(null);
                        setManageTab(t.id);
                      }}
                      className={
                        manageTab === t.id
                          ? "rounded-full bg-neutral-100 px-3 py-1.5 text-sm text-neutral-900"
                          : "rounded-full px-3 py-1.5 text-sm text-neutral-400 transition-colors hover:bg-neutral-900 hover:text-neutral-100"
                      }
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {manageTab === "add" && (
                  <div className="mx-auto max-w-2xl">
                    <AdminForm />
                  </div>
                )}

                {manageTab === "import" && (
                  <div className="mx-auto max-w-4xl">
                    <ImportForm onManage={() => setManageTab("manage")} />
                  </div>
                )}

                {manageTab === "manage" && (
                  <div className="space-y-6 overflow-x-auto">
                    {tabError ? (
                      <p className="text-sm text-red-400">{tabError}</p>
                    ) : manage === null ? (
                      <p className="text-sm text-neutral-500">Loading…</p>
                    ) : (
                      <ManageList
                        items={manage.items}
                        page={manage.page}
                        totalPages={manage.totalPages}
                        query={manage.query}
                        onNavigate={(next) => loadManage(next)}
                        onChanged={() =>
                          loadManage({ page: manage.page, q: manage.query })
                        }
                      />
                    )}
                  </div>
                )}

                {manageTab === "tokens" && (
                  <div className="mx-auto max-w-3xl">
                    {tabError ? (
                      <p className="text-sm text-red-400">{tabError}</p>
                    ) : tokens === null ? (
                      <p className="text-sm text-neutral-500">Loading…</p>
                    ) : (
                      <TokensClient initialTokens={tokens} onChanged={loadTokens} />
                    )}
                  </div>
                )}

                {manageTab === "guestbook" && (
                  <div className="mx-auto max-w-4xl">
                    {tabError ? (
                      <p className="text-sm text-red-400">{tabError}</p>
                    ) : entries === null ? (
                      <p className="text-sm text-neutral-500">Loading…</p>
                    ) : (
                      <GuestbookAdminList
                        entries={entries}
                        onChanged={loadGuestbook}
                      />
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating + trigger, above the maker-credit pill. Signed out it opens
          the sign-in popup; signed in it toggles a small menu (Write / Manage /
          Onboarding / Log out) that floats above it. */}
      <div
        ref={menuWrapRef}
        className={`fixed right-4 z-40 flex flex-col items-end ${
          isGarden ? "bottom-20" : "bottom-12"
        }`}
      >
        {authed && menuOpen && (
          <MenuPanel className="mb-2 w-48">
            <MenuItem
              label="Write"
              onClick={() => {
                setMenuOpen(false);
                openNew();
              }}
            />
            <MenuItem
              label="Manage"
              onClick={() => {
                setMenuOpen(false);
                openManage();
              }}
            />
            <MenuDivider />
            <MenuItem
              label="Onboarding"
              onClick={() => {
                setMenuOpen(false);
                window.dispatchEvent(new Event("svemir:play-intro"));
              }}
            />
            <MenuItem
              label="Log out"
              danger
              onClick={() => {
                setMenuOpen(false);
                logout();
              }}
            />
          </MenuPanel>
        )}
        <button
          type="button"
          onClick={
            authed ? () => setMenuOpen((o) => !o) : () => setSignInOpen(true)
          }
          aria-label={authed ? "Quick add menu" : "Sign in"}
          aria-haspopup={authed ? "menu" : undefined}
          aria-expanded={authed ? menuOpen : undefined}
          // Same liquid glass as the menus (.glass-panel: theme-tinted, frosted,
          // hairline rim - no glow). Rests slightly dimmed and clears to full on
          // hover so it stays discoverable without shouting.
          className="glass-panel flex h-11 w-11 items-center justify-center rounded-full border border-neutral-800 text-xl text-neutral-100 opacity-90 transition-opacity hover:opacity-100"
        >
          <span className="-mt-0.5 leading-none">+</span>
        </button>
      </div>

      {!authed && (
        <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
      )}
    </>
  );
}
