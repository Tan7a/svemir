# Graph multi-view + concept layer — handoff

Status as of this commit: **Phase 1 (Garden + switcher) shipped and build-green.** Next: **Phase 1.5 —
make the Garden look like the reference**, then Phase 2 (Topologies layouts).

## View mapping (`/graph` switcher, `?view=`)
- **Garden** — 3D L-system plants, one per channel; blocks are leaves (oldest = base, newest = tip).
  `components/IdeaGarden.tsx` + `lib/lsystem.ts`.
- **Topologies** — the block/concept force-graph (`components/KnowledgeGraph.tsx`, 2D). Phase 2 adds
  Centralized / Decentralized / Distributed layouts (no-AI: channels = clusters, degree-centrality = center).
- **Concepts** — prevalence word-cloud (`components/ConceptCloud.tsx`), shared with the `/concepts` page.

Switcher: `components/GraphViewSwitcher.tsx`. Data fetched in `app/graph/page.tsx` (server) and passed down.

## Constraints (do not break)
- **No AI / no embeddings** — cluster by channels + local concept extraction only.
- **No glow / no bloom** — flat matte materials.
- **Original code only** — the reference apps (Kat Zhang, personal-use license) are *inspiration only*;
  never copy their code into this public repo.
- Next 16: `ssr:false` only inside client components; `useSearchParams` needs `<Suspense>`. Strict TS.
- Three.js scenes must fully dispose on unmount (StrictMode double-mounts in dev) — see IdeaGarden cleanup.

## Phase 1.5 — Garden visual refinement (the next task)
Make the Garden much closer to the "Idea Garden" reference, staying no-glow. In `lib/lsystem.ts` +
`components/IdeaGarden.tsx`:
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

## Phase 2 — Topologies (3D), no AI
Add `3d-force-graph`. Block nodes; edges = manual + shared-concept. Three layouts via precompute-coords +
eased position-force. Clusters = channels; center = most-connected block.

## Setup notes
- Deps already added: `three`, `@types/three`, plus `d3-force-3d` (transitive, ambient-typed via
  `d3-force-3d.d.ts`).
- **Run `supabase/migrations/0006_concepts_and_fts.sql` in Supabase** (concepts/FTS) if not already, then
  `/admin/manage` → **Extract concepts** to populate.
- Verify: `npx tsc --noEmit` (0), `npm run build` (17/17), `npm run dev` → `/graph`.

Full rationale + decisions: see the planning notes that accompanied this work.
