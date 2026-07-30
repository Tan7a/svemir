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
  via `onRootSelect` / `onTreeSelect`. Known gap: on a narrow screen the panel's bottom sheet covers
  the timeline scrubber. Not addressed.

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
- **Hover priority: pill > leaf > root > trunk**, one pass (`computeHover`), with
  `raycaster.params.Line.threshold` scaled to the scene. Click order: pill -> channel page, leaf ->
  block page, root -> panel, trunk/branch -> panel, empty ground -> motion toggle (and ONLY then,
  and only off `lite`: on a phone the sky is most of the screen and stray taps fired it constantly).
  Clicks re-raycast synchronously so mobile taps work without a hover frame.
- **Label pills are `pointer-events: none`, and that is LOAD-BEARING. Do not "restore" it.** The
  pills live in the overlay, a SIBLING of the canvas, and OrbitControls listens only on
  `renderer.domElement`. While they were interactive, any drag or pinch starting on a label reached
  nothing (and a two-finger one could become a browser page-zoom). On a phone the pills crowd the
  middle of the screen, exactly where a thumb lands, so that ate most gestures. Taps and hover are
  resolved instead by `pillAt()`, a screen-space box test reusing the boxes the label layout already
  computes. That is also why there are no per-pill listeners: one rect test replaced 3N of them.
- **Labels are NEVER hidden to resolve crowding.** `updateLabels` runs three passes per frame,
  allocating nothing: project every anchor, resolve overlaps, write the DOM. A crowded pill *rises
  up its own leader line* until clear, so it simply hangs on a longer string. Ordering is by
  projected `sy` DESCENDING: the camera looks down from 20°, so a further tree projects HIGHER, and
  placing the nearest first keeps the front row on its own crowns and pushes distant ones into the
  empty sky. The climb is capped (scaled to viewport height, since a fixed cap could not resolve
  60-odd labels in a 375px-tall landscape phone), clamped clear of the top chrome band and both
  edges. Clamp what is DRAWN, not just the target: the lift is eased, so an unclamped draw position
  paints off-screen before it settles. A downward fallback for pills pinned at the inset was tried
  and removed (it re-collided after the clamps). Residual overlap under extreme crowding is the
  accepted trade for never dropping a name.
- **Never read layout in the frame loop.** `width`/`height` are cached and written by the
  ResizeObserver; pills are positioned by `transform: translate3d(...)`, never `left`/`top` (not
  compositable). Pill boxes are measured ONCE (plus once on `document.fonts.ready`, since Inter
  arriving late changes every width) and on resize.
- **Hover raycasting is gated.** Skipped entirely while `dragging`, and touch never enters the
  frame-loop hover path at all (`pointerInside` is only set for non-touch pointers) since taps do
  their own synchronous pass. Before this, a full-scene raycast ran on every pan and pinch frame.
  `pointerup` / `pointercancel` handlers exist so an interrupted iOS gesture cannot latch hover on
  or wedge the drift off.
- **`lite` vs viewport-derived is a deliberate split.** `lite` (read once at build:
  `(pointer: coarse)` or width < 640) covers only what cannot change without rebuilding the scene:
  pixel density, grass/crystal/bird counts, damping, `zoomToCursor`. Everything about LAYOUT keys off
  the live viewport instead (`stylePills`, `placeScrubber`, `setOrthoFrustum`), because layout has to
  follow the window it is in. Latching layout left phone-sized pills and a phone-placed scrubber on a
  desktop window resized after mount.
- **Small viewports crop rather than fit-all.** `setOrthoFrustum` keeps fit-everything for roomy
  landscape, but a narrow OR short viewport frames on the TREES: `maxH * 2 / sqrt(aspect)`. Anchoring
  to `sceneR` does not work, because it grows with sqrt(channel count) and would shrink the trees
  again as the archive grows; the `sqrt(aspect)` divisor holds the number of visible trees roughly
  constant however the phone is held. `controls.minZoom` is DERIVED from that ratio, not fixed, so
  pinching out always still reaches the whole ring.
- **Antialiasing stays on, phones included.** The scene is thin diagonal line-art, the worst case for
  stair-stepping, and mobile GPUs resolve MSAA cheaply in tile memory. Pixels are saved with a lower
  density cap (1.5 vs 2) and a third of the grass stipple instead.
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
