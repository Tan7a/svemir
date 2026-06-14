# Graph multi-view + concept layer — handoff

Status as of this commit: **Phases 1, 1.5, and 2 shipped and build-green.** The Garden matches the
reference's wireframe line-art look; Topologies has the three no-AI layouts. Possible next work: tune
topology spacing/strengths, an optional 3D Topologies, or further Garden polish.

## View mapping (`/graph` switcher, `?view=`)
- **Garden** — 3D L-system plants, one per channel; blocks are leaves (oldest = base, newest = tip).
  `components/IdeaGarden.tsx` + `lib/lsystem.ts`. **Shipped (Phase 1.5):** flat **wireframe** line-art
  (no gradient, no shading), orthographic low-angle camera with gentle auto-rotate (click empty space to
  toggle), per-channel L-system variety, channel-name **"balloons"** floating above each plant, animated
  **"bee"** dashed flight-paths, triangle/sparkle dust, and a `created_at` **timeline scrubber**.
- **Topologies** — the block/concept force-graph (`components/KnowledgeGraph.tsx`, 2D). **Shipped (Phase 2):**
  a **Centralized / Decentralized / Distributed** layout switcher (no-AI: channels = clusters,
  degree-centrality = hub) via precomputed per-node targets eased in with `forceX`/`forceY`.
- **Concepts** — prevalence word-cloud (`components/ConceptCloud.tsx`), shared with the `/concepts` page.

Switcher: `components/GraphViewSwitcher.tsx`. Data fetched in `app/graph/page.tsx` (server) and passed down.

## Constraints (do not break)
- **No AI / no embeddings** — cluster by channels + local concept extraction only.
- **No glow / no bloom** — flat matte materials.
- **Original code only** — the reference apps (Kat Zhang, personal-use license) are *inspiration only*;
  never copy their code into this public repo.
- Next 16: `ssr:false` only inside client components; `useSearchParams` needs `<Suspense>`. Strict TS.
- Three.js scenes must fully dispose on unmount (StrictMode double-mounts in dev) — see IdeaGarden cleanup.

## Phase 1.5 — Garden visual refinement ✅ DONE
Shipped. Key deviations from the original list below, driven by the reference screenshots: branches are
flat **thin lines** (`LineSegments`) with **no gradient**, and leaves are **wireframe** shapes — the
reference is line-art, not solid/tapered. The side leader-line labels became **floating "balloon" labels
above each plant**; the dotted ground trails became **animated bee flight-paths** (dashed `Line` +
travelling dot); dust uses **triangle + sparkle** point sprites. Original target list (kept for reference):
1. Organic, clearly **tapered trunks**; branch color gradient base→tip.
2. **Per-plant variety** via the seeded PRNG (pitch, length decay, internodes, trunk wobble, apical
   dominance) so plants differ.
3. **Leaves**: varied shape (sphere/cube/octahedron) + a small **color palette per plant**; tune size.
4. **Dust** specks on the ground; subtle.
5. **Gentle camera auto-rotation** + nicer initial framing (consider orthographic).
6. **Side labels with leader lines** (channel names at screen edges, thin lines to plants) — the
   reference's signature look and the biggest "feels like it" win.
7. Size-aware plant spacing (no collisions).
8. *(Optional)* timeline scrubber to grow plants by `created_at`.

## Phase 2 — Topologies ✅ DONE (2D)
Implemented in `components/KnowledgeGraph.tsx` as a layout switcher on the existing 2D graph — **no new
dependency** (2D chosen over the doc's original 3D `3d-force-graph` idea to avoid a heavy dep and keep the
flat aesthetic). Each layout precomputes a per-node target `(tx,ty)` and eases nodes in with `forceX`/
`forceY`; charge/link are weakened so the shape wins, collision prevents overlap.
- **Centralized** — single degree-centrality hub at the centre, others on a phyllotaxis spiral (best-
  connected nearest the core).
- **Decentralized** — one cluster per channel arranged on a ring (each cluster's top node as its local
  hub); concepts settle at the centroid of the blocks that mention them.
- **Distributed** — no hub; an even phyllotaxis mesh.

Future option: a 3D Topologies (custom Three.js to keep the flat look, or the `3d-force-graph` lib).

## Setup notes
- Deps already added: `three`, `@types/three`, plus `d3-force-3d` (transitive, ambient-typed via
  `d3-force-3d.d.ts`).
- **Run `supabase/migrations/0006_concepts_and_fts.sql` in Supabase** (concepts/FTS) if not already, then
  `/admin/manage` → **Extract concepts** to populate.
- Verify: `npx tsc --noEmit` (0), `npm run build` (17/17), `npm run dev` → `/graph`.

Full rationale + decisions: see the planning notes that accompanied this work.
