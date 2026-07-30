# Idea Garden - handoff

`/graph` IS the Garden now. The multi-view switcher (Garden / Map / Concepts) and the 3D force-graph
Map were deleted in the garden-roots release (July 2026); the Map's one unique value, showing which
channels share conceptual ground, moved into the Garden as a **root system**, and the concept cloud
moved into a collapsible **side panel**. `KnowledgeGraph.tsx`, `GraphViewSwitcher.tsx`,
`lib/use-theme-palette.ts`, `d3-force-3d.d.ts`, and `app/concepts/` are recoverable via git history.

## Architecture

- **`app/graph/page.tsx`** (server, anon client, `revalidate = 60`) fetches three things in parallel:
  channels + blocks (the trees), the concept cloud (2+ block floor, limit 500), and the
  `channel_concept_pairs` RPC (migration 0013). It shapes RPC rows into `GardenRoot`s: both endpoints
  must be planted channels, weight is normalized 0..1 against the strongest pair, then a greedy
  density cap thins them (strongest first, max 4 roots per channel, but every channel keeps its
  single strongest pair). RPC errors, including "0013 not run yet", degrade to zero roots.
- **`components/GardenShell.tsx`** (client) owns the panel: open/closed + selection
  (`root` pair / `tree` channel / none). Panel state lives HERE, never in IdeaGarden props, so
  toggling it can never rebuild the WebGL scene. The panel is an absolute overlay (z-40), not a flex
  sibling: the canvas mount is measured by a ResizeObserver, and a width-changing sibling would
  cause a resize feedback loop. Small screens get a bottom sheet.
- **`components/IdeaGarden.tsx`** (client, pure Three.js) draws trees + roots and reports clicks up
  via `onRootSelect` / `onTreeSelect`.

## Roots data flow

```
0013 channel_concept_pairs (SQL, SECURITY INVOKER)
  -> app/graph/page.tsx (filter / normalize / thin -> GardenRoot[])
    -> GardenShell -> IdeaGarden `roots` prop (server-serialized, referentially stable)
```

The RPC MUST stay `SECURITY INVOKER`: anon RLS on connections/channels (0012) is what keeps private
channels out of the public garden. Weighting mirrors `related_blocks` (0006): per channel x concept
summed tf, `idf = ln(total/df)`, 40% max-df cap, pair weight `sum(least(tf_a, tf_b) * idf^2)`.

## Rendering constraints (do not break)

- **Scene rebuilds are the top hazard.** The whole scene + DOM overlay is built in ONE effect with
  deps `[gardens, roots, router, themeKey]`. `roots` is safe as a dep only because it is
  server-serialized page data; the selection **callbacks go through refs** (the showLabels/motionOn
  state+ref pattern), never into the deps. A fresh array/function prop per render = full WebGL
  rebuild.
- **Roots are scene-level siblings of the tree groups, never children.** The timeline scrub scales
  (`group.scale.y`) and hides whole tree groups; a root parented to a tree would stretch with it.
  Instead `updateRoots()` runs per frame: a root is visible iff both endpoint groups are visible,
  and its opacity target is scaled by the younger endpoint's growth.
- **No glow, no bloom, ever.** Depth cue = flat per-vertex colour ramp from ink toward the sky
  colour; weight = strand count (1/2/3, parallel offsets in ONE geometry) + opacity. `linewidth` is
  a no-op on WebGL. Root materials are per-root instances (`transparent`, `depthWrite: false`,
  `vertexColors: true`) so each root eases its own hover opacity.
- **Hover priority: leaf > root > trunk**, one raycast pass (`computeHover`), with
  `raycaster.params.Line.threshold` scaled to the scene. Click order: leaf -> block page, root ->
  panel, trunk/branch -> panel, empty ground -> motion toggle (and ONLY then). Clicks re-raycast
  synchronously so mobile taps work without a hover frame.
- Three.js scenes must fully dispose on unmount (StrictMode double-mounts in dev). The existing
  `scene.traverse` teardown covers per-root geometry/materials because roots are scene children.
- **No AI / no embeddings**: concepts come from local term extraction only.
- **Original code only**: poetengineer (https://x.com/poetengineer__) is *inspiration only*,
  credited in-view and in the IdeaGarden header comment. Never copy reference code.
- Next 16: `ssr:false` only inside client components. Strict TS.

## Panel

Default view: CONCEPTS_EXPLAINER + `ConceptCloud` (`compact` prop caps sizes for the 320px column).
Root selected: "{A} and {B}", shared count, term links to `/concept/[slug]`, endpoint channel links.
Tree selected: one row per incident root; row click promotes to the root view.

## Related removals

`/concepts` now 307s to `/graph` (`next.config.ts` `redirects()`; flip to 308 once proven).
`channelMapColor` / `BrandColor.mapHex` are gone from `lib/constants.ts`: channel identity is one
palette, everywhere. npm: `react-force-graph-3d`, `react-force-graph-2d`, `three-spritetext` removed.

## Setup

- **Run `supabase/migrations/0013_channel_concept_pairs.sql` in the Supabase SQL editor** (the page
  tolerates its absence: garden renders, just no roots). Anon smoke test in the migration footer.
- Verify: `npm run lint` (0), `npm run build`, `npm run dev` -> `/graph`.
