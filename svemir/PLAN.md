# Inspiration Archive — Plan & Roadmap

A personal knowledge base for inspiration links, with bulk import from Chrome bookmarks, free-form tagging, an Obsidian-style knowledge graph, and per-item detail pages.

## Stack

- **Next.js 16** (App Router, Turbopack), TypeScript
- **Tailwind CSS v4** (no config file; `@import "tailwindcss"` in `globals.css`)
- **Supabase** (`@supabase/supabase-js`) — anon/publishable key for reads, service-role for writes
- **`open-graph-scraper`** for URL metadata
- **`react-force-graph-2d`** for the knowledge graph
- HTTP Basic Auth on `/admin/*` via Next.js 16 `proxy.ts` (renamed from `middleware.ts`)
- Vercel-ready

## Done so far

### Foundation
- Scaffolded with `create-next-app@latest` (Next 16, TS, Tailwind v4, App Router, no src dir).
- Inter font, off-white `#FBF8F4` background.
- `next.config.ts` with wildcard `remotePatterns` for `next/image` from any HTTPS host, and `turbopack.root` to silence the workspace-root warning.
- `.env.local` / `.env.example` set up; `.env.local` gitignored, `.env.example` exception added.

### Database (Supabase)
- `items` table extended with a `notes text` column (column exists; no UI yet).
- `tags` table with `lower(name)` unique index, slug auto-generated as a stored generated column.
- `item_tags` junction table (composite PK).
- RLS enabled on all three; public `SELECT` policies; INSERT/UPDATE/DELETE only via service-role.
- 10 starter tags seeded: typography, ui, animation, ai, tools, writing, illustration, product, data-viz, branding.

### Pages & components
- **`/archive`** — public grid view. Sticky search bar, sticky filter bar (category pills), tag picker (multi-select with AND logic), Graph link. Cards link to detail pages; an "open original ↗" icon opens the source URL in a new tab.
- **`/graph`** — Obsidian-style force-directed knowledge graph. Edges = pairs of items sharing tags. Click a node → its detail page.
- **`/item/[id]`** — detail page: hero image, title, source, description, "Open original →" CTA, categories, tags, "Related" grid (items with the most tag overlap, capped at 12).
- **`/admin`** — Basic-Auth-protected single-add form. URL → auto-fetches OG metadata after 500ms debounce; paste a screenshot anywhere on the form to upload it as the image; `⌘+Enter` saves; tag chips with autocomplete from existing tags.
- **`/admin/import`** — bulk import from a Chrome bookmarks `.html` file. Parser extracts URL/title/folder path. Folder names → tags; folder names matching one of the 8 fixed categories also fill in `categories`. Preview shows folder tree with checkboxes (default: all selected); user picks which folders to import. Inserts in chunks of 200; per-URL dedup so re-runs are safe.
- **`/admin/manage`** — paginated table (50/page), search by title/description/URL, per-row inline edit of tags & categories, per-row delete, multi-select bulk delete, "Scrape missing (10)" button to fill OG metadata for items still bare from the import.
- **`/api/scrape`** — POST URL → returns OG title, description, image, source name, source type.
- **`/api/parse-bookmarks`** — POST multipart `file` → returns `{ totalBookmarks, folders, bookmarks }`.
- **`/api/upload-image`** — POST multipart `file` → uploads to Supabase Storage `screenshots` bucket (auto-created on first call), returns public URL.
- **`proxy.ts`** — HTTP Basic Auth on `/admin/:path*`, credentials from `ADMIN_USERNAME`/`ADMIN_PASSWORD`.

### Knowledge graph fixes (most recent)
The original implementation collapsed into unreadable label clumps with 1156 imported items. Fixed by:
- Filtering out **common tags** (any tag appearing on >10% of items, or >50, whichever is larger) from edge computation — these are too generic to be meaningful connections.
- Requiring a configurable **minimum overlap** (default: 2 shared tags) for an edge to exist.
- **Capping total edges at 4000**, sorted by weight, to keep the canvas fast.
- **Hiding labels at low zoom** (`globalScale < 1.4`) so the layout is readable when zoomed out.
- **World-space font size** (constant 4 in graph units) so labels shrink/grow consistently with zoom.
- Tuned d3 force: charge `-90`, link distance `60`. Auto `zoomToFit` after settle.
- A floating control bar lets the user adjust min-overlap and toggle common-tag filtering.

## What's next (deferred / unbuilt)

Pick up here in the next chat — these are the user's open requests, in priority order:

### 1. Global navigation menu (NOT YET BUILT)
A persistent top header on every page (`/archive`, `/graph`, `/item/[id]`, all `/admin/*`):
- Brand on the left (e.g. "Inspiration Archive")
- Center/right: Archive · Graph · **+ Add** (filled primary button) · Organise · Logout
- The `+ Add` button covers the user's "+ button" ask in the same affordance.
- File: new `components/GlobalNav.tsx` (replaces existing `components/AdminNav.tsx`).
- Will need to adjust `/archive` floating search bar from `top-4` to `top-16` (or similar) so it doesn't overlap.

### 2. Logout (NOT YET BUILT)
HTTP Basic Auth has no clean cross-browser logout, but a workable approach:
- New `app/api/logout/route.ts` returning 401 with a *different* `WWW-Authenticate` realm — this clears the cached credentials for the original realm in Chrome/Firefox.
- Logout link in `GlobalNav` calls this then redirects to `/archive`.
- Note in PLAN: a more robust path is to switch to session cookies (`@supabase/ssr` or a custom signed cookie). Defer unless needed.

### 3. "Organise" mode — bulk multi-select with delete + bulk-tag (PARTIALLY BUILT)
- `/admin/manage` already has multi-select + bulk delete in a list view. Missing:
  - A **bulk-add-tag** action (server action `bulkAddTag(ids, tagName)`) and a bulk toolbar UI for it.
  - A **grid view toggle** (List / Grid) — grid view shows thumbnails with a checkbox in the corner, more visual for triage. Same multi-select state, same bulk actions.
- The user used the word "folders" — in this app's model, folders == tags. Bulk-add-tag is the "move to folder" action.

### 4. Per-card "↻ Re-scrape" affordance on `/archive` (NOT YET BUILT)
A small button that lets you re-fetch OG metadata for a single card if its image/description came back wrong. Calls the existing `scrapeAndUpdateItem` server action.

### 5. Notes editing UI (NOT YET BUILT)
The `notes` column exists on `items` but there's no UI to set it. Add an editable textarea on `/item/[id]` (Basic-Auth gated) and a server action `updateNotes(id, notes)`.

### 6. Postgres full-text search (DEFERRED)
Current search is client-side substring across title/description/source/tag-names. Fine up to ~1000 items; switch to Postgres `tsvector` + `websearch_to_tsquery` if the archive grows past that.

### 7. Mobile graph polish (DEFERRED)
`react-force-graph-2d` works on mobile but pinch-zoom + tap targets aren't tuned.

### 8. AI-assisted tagging (DEFERRED — user opted out)
A previous plan included Claude Haiku auto-suggesting tags at scrape time. User chose manual-only. Reconsider when there are many ungrouped items.

## Architecture notes for next session

- **Server vs client boundary**: `lib/supabase-server.ts` (service-role) must never be imported by a client component. Reads from `lib/supabase-client.ts` (publishable key) are safe on either.
- **Tag dedup**: `ensureTagId` does insert-then-fallback-to-select with a case-insensitive match (`.ilike('name', name)`), backed by a `lower(name)` unique index. Race-safe enough for personal scale.
- **Supabase nested select typings**: when using `select("*, item_tags(tags(*))")`, Supabase's inferred type sometimes treats `tags` as an array even when the FK is one-to-one. Helper `asTagList(unknown)` in `app/graph/page.tsx` and `app/admin/manage/page.tsx` defensively normalises both shapes.
- **Next.js 16 quirks worth knowing**:
  - Middleware was renamed → `proxy.ts` exporting a `proxy` function.
  - `params` and `searchParams` are now `Promise<...>` and must be awaited.
  - `revalidate = 60` still works; `dynamic = "force-dynamic"` on `/admin/manage` because we read `searchParams` for pagination.
  - Bundled docs at `node_modules/next/dist/docs/` are the source of truth — `AGENTS.md` already points future agents there.

## Setup recap (for fresh clones)

1. `cd inspiration-archive && npm install`
2. `.env.local` needs:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon or publishable>
   SUPABASE_SERVICE_ROLE_KEY=<service role>
   ADMIN_USERNAME=<choose>
   ADMIN_PASSWORD=<choose>
   ```
   No spaces around the `=`.
3. Run the SQL migration (in Supabase SQL Editor) — see chat history for the idempotent version with `drop policy if exists` guards.
4. `npm run dev` → http://localhost:3000 → `/archive`. Visit `/admin/import` to bulk-load Chrome bookmarks.

## Out of scope for this archive

- No deployment automation (user deploys to Vercel manually).
- No user accounts beyond Basic Auth.
- No per-item ACLs — archive is fully public read.
- No mobile-first redesign yet.
