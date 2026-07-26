"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import * as THREE from "three";
import SpriteText from "three-spritetext";
import { forceCollide, forceRadial } from "d3-force-3d";
import { channelColor } from "@/lib/constants";
import { useThemePalette } from "@/lib/use-theme-palette";

// react-force-graph-3d's TypeScript generics don't survive next/dynamic, so
// we treat it as a permissive component and rely on our own GraphNode/GraphLink
// types inside callbacks.
const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-sm text-neutral-500">
      Loading galaxy…
    </div>
  ),
}) as ComponentType<Record<string, unknown>>;

export type GraphItem = {
  id: string;
  title: string;
  tagIds: string[];
  tagNames: string[];
  tagSlugs: string[];
  category: string | null;
  img: string | null;
  kind: string;
};

export type ManualEdge = { a: string; b: string };

export type GraphConcept = {
  id: string;
  slug: string;
  term: string;
  blockCount: number;
};

export type BlockConceptLink = {
  blockId: string;
  conceptId: string;
  weight: number;
};

type Props = {
  items: GraphItem[];
  manualEdges?: ManualEdge[];
  concepts?: GraphConcept[];
  blockConceptLinks?: BlockConceptLink[];
};

type NodeKind = "block" | "concept" | "channel";
type LinkKind = "manual" | "concept" | "channel";

type GraphNode = {
  id: string;
  name: string;
  category: string | null;
  tags: string[]; // channel names (for the detail card / tooltip)
  tagIds: string[]; // channel ids (for stable colour)
  type: NodeKind;
  color: string;
  slug?: string;
  prevalence?: number;
  img?: string | null; // block thumbnail for the detail card
  // Link degree (centrality) - drives node size, Obsidian-style.
  deg?: number;
  // Written by d3-force once the simulation runs, not by us.
  x?: number;
  y?: number;
  z?: number;
};

type GraphLink = {
  source: string;
  target: string;
  value: number;
  manual: boolean;
  kind: LinkKind;
};

// Obsidian-ish layers: channel-less blocks are a neutral grey, concepts share a
// single warm accent so they read as a distinct layer over the channel colours.
const BLOCK_NEUTRAL = "#98989d"; // iOS systemGray
const CONCEPT_COLOR = "#e8b563";
const CONCEPT_HEX = "#f59e0b"; // detail-card accent

const conceptNodeId = (id: string) => `concept:${id}`;
const channelNodeId = (id: string) => `channel:${id}`;

// Golden angle in radians - fibonacci-lattice spacing for the hub sphere.
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** Sphere radius sized so ~K hubs get comfortable spacing on its surface. */
function sphereRadius(hubCount: number): number {
  return Math.max(180, 28 * Math.sqrt(Math.max(1, hubCount)));
}

/** Deterministic [0,1) from a string - keeps the constellation seeding stable. */
function hash01(s: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}


// Normalise a link endpoint to its id - force-graph mutates source/target from
// id strings into node objects once the simulation runs.
function linkEndId(end: unknown): string {
  return typeof end === "object" && end !== null
    ? String((end as { id: string }).id)
    : String(end);
}

/** Escape a title for the hover-tooltip HTML string. */
function escapeHTML(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── stardust speck texture ────────────────────────────────────────────────────
// One soft-edged dust mote, drawn once and shared; every node tints it via its
// sprite material colour + opacity. Solid core with a short alpha falloff at
// the rim - edge softness on the particle itself (same idea as the garden's
// grass dots), NOT a halo: normal blending, nothing radiates onto neighbours.
let dustTex: THREE.Texture | null = null;

function dustTexture(): THREE.Texture {
  if (dustTex) return dustTex;
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.55, "rgba(255,255,255,1)"); // solid core
  g.addColorStop(1, "rgba(255,255,255,0)"); // soft rim
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  dustTex = tex;
  return tex;
}

// World-space radius of a node's dot - scales with its link count (degree), so
// well-connected hubs read bigger. Shared by the painter, the click hit-area,
// and the collision force so spacing matches what's drawn.
function nodeRadius(node: { deg?: number }): number {
  return 2 + Math.sqrt(node.deg ?? 0) * 0.9;
}

type UniverseAudio = { stop: () => void };

// Procedural deep-space ambience (Web Audio, no external asset), the Map's
// counterpart to the Garden's forest sound: a low drone a fifth apart that
// beats slowly against itself, a dark filtered-noise bed for the cosmic
// background, and sparse long-decay bell tones that read as distant stars.
// Created on a user gesture (the Sound toggle) so it satisfies autoplay rules,
// and fades in/out rather than clicking on.
function startUniverseAudio(): UniverseAudio {
  const ctx = new AudioContext();
  void ctx.resume();
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  const t0 = ctx.currentTime;
  master.gain.setValueAtTime(0, t0);
  master.gain.linearRampToValueAtTime(0.42, t0 + 2.5); // slow swell

  // Drone: root + fifth, detuned a few cents so they beat against each other
  // over several seconds. Kept under a lowpass so it stays a hum, not a tone.
  const droneFilter = ctx.createBiquadFilter();
  droneFilter.type = "lowpass";
  droneFilter.frequency.value = 320;
  const droneGain = ctx.createGain();
  droneGain.gain.value = 0.16;
  droneFilter.connect(droneGain).connect(master);

  const drones = [48, 72, 96].map((freq, i) => {
    const osc = ctx.createOscillator();
    osc.type = i === 2 ? "sine" : "triangle";
    osc.frequency.value = freq;
    osc.detune.value = i * 7 - 7; // a few cents apart -> slow beating
    const g = ctx.createGain();
    g.gain.value = i === 2 ? 0.25 : 1;
    osc.connect(g).connect(droneFilter);
    osc.start();
    return osc;
  });

  // Cosmic background: brown-ish noise, darker and quieter than the garden's
  // wind so it sits under the drone rather than beside it.
  const len = Math.floor(3 * ctx.sampleRate);
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.015 * white) / 1.015;
    data[i] = last * 3.4;
  }
  const hiss = ctx.createBufferSource();
  hiss.buffer = buffer;
  hiss.loop = true;
  const hissFilter = ctx.createBiquadFilter();
  hissFilter.type = "lowpass";
  hissFilter.frequency.value = 220;
  const hissGain = ctx.createGain();
  hissGain.gain.value = 0.16;
  hiss.connect(hissFilter).connect(hissGain).connect(master);
  hiss.start();

  // Very slow LFOs so the whole bed breathes instead of sitting static.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.035;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 120;
  lfo.connect(lfoGain).connect(droneFilter.frequency);
  const lfo2 = ctx.createOscillator();
  lfo2.frequency.value = 0.021;
  const lfo2Gain = ctx.createGain();
  lfo2Gain.gain.value = 0.07;
  lfo2.connect(lfo2Gain).connect(hissGain.gain);
  lfo.start();
  lfo2.start();

  // Distant stars: occasional bell tones on a pentatonic set, panned wide,
  // with a long exponential tail so they hang in the space.
  const SCALE = [329.63, 392.0, 440.0, 493.88, 587.33, 659.25];
  let stopped = false;
  let timer = 0;
  const ping = () => {
    if (stopped) return;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.7 - 0.85;
    pan.connect(master);
    const f = SCALE[Math.floor(Math.random() * SCALE.length)];
    const start = ctx.currentTime + 0.02;
    const decay = 3.5 + Math.random() * 3;
    // Fundamental plus a quiet octave for a glassy, bell-like timbre.
    [
      [f, 0.055],
      [f * 2, 0.018],
    ].forEach(([freq, peak]) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, start);
      g.gain.linearRampToValueAtTime(peak, start + 0.35); // soft, no click
      g.gain.exponentialRampToValueAtTime(0.0001, start + decay); // never exactly 0
      osc.connect(g).connect(pan);
      osc.start(start);
      osc.stop(start + decay + 0.1);
    });
    // Drop this ping's panner once it has rung out, so idle nodes don't pile
    // up on master over a long session.
    window.setTimeout(() => {
      try {
        pan.disconnect();
      } catch {
        // context closed; ignore
      }
    }, (decay + 1) * 1000);
    timer = window.setTimeout(ping, 5000 + Math.random() * 7000);
  };
  timer = window.setTimeout(ping, 1800);

  return {
    stop: () => {
      stopped = true;
      window.clearTimeout(timer);
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(0, t + 1.2); // fade-out
      window.setTimeout(() => {
        try {
          drones.forEach((d) => d.stop());
          hiss.stop();
          lfo.stop();
          lfo2.stop();
          void ctx.close();
        } catch {
          // context already closing; ignore
        }
      }, 1300);
    },
  };
}

/**
 * Build one node's 3D object. Fine translucent particles: flat billboard discs
 * in the node's channel colour with real opacity, so overlapping particles
 * build density instead of solid balls. Blocks are small dust, hubs are larger
 * soft blobs, concepts sit between. Channel names float above their hub; other
 * names show in the hover tooltip. Flat matte throughout - no glow.
 *
 * Deliberately module-level, NOT an inline prop: three-forcegraph wipes and
 * rebuilds every node object whenever this accessor's identity changes
 * (`nodeDataMapper.clear()`), so an inline arrow re-created all ~900 sprites on
 * every single React render - including on every hover, since onNodeHover sets
 * state. It reads nothing but the node itself, so hoisting it is free.
 */
function renderNodeObject(raw: unknown): THREE.Object3D {
  const n = raw as GraphNode;
  const isHub = n.type === "channel";
  const isConcept = n.type === "concept";
  const r = 4 * Math.cbrt(Math.min(60, Math.max(1, n.deg ?? 1)));
  // Stardust scale: blocks are tiny motes, hubs stay modest and let their
  // floating label do the identifying. Density comes from many overlapping
  // specks, not from big shapes.
  const d = isHub ? r * 1.5 : isConcept ? r * 0.9 : r * 0.8;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: dustTexture(),
      color: new THREE.Color(n.color),
      transparent: true,
      opacity: isHub ? 0.9 : isConcept ? 0.5 : 0.85,
      depthWrite: false,
    })
  );
  sprite.scale.set(d, d, 1);
  if (!isHub) return sprite;
  const group = new THREE.Group();
  group.add(sprite);
  const label = n.name.length > 28 ? n.name.slice(0, 26) + "…" : n.name;
  const text = new SpriteText(label);
  text.textHeight = 6.5;
  text.color = "#d6d6dc";
  text.fontWeight = "600";
  text.fontFace = "Inter, system-ui, sans-serif";
  text.material.depthWrite = false;
  text.position.y = d / 2 + 7;
  group.add(text);
  return group;
}

type GraphHandle = {
  d3Force: (
    name: string,
    force?: unknown
  ) =>
    | {
        strength?: (n: unknown) => unknown;
        distance?: (n: unknown) => unknown;
      }
    | undefined;
  d3ReheatSimulation?: () => void;
  getGraphBbox?: () => {
    x: [number, number];
    y: [number, number];
    z: [number, number];
  } | null;
  cameraPosition?: (
    pos: { x: number; y: number; z: number },
    lookAt?: { x: number; y: number; z: number },
    ms?: number
  ) => void;
  scene?: () => THREE.Scene;
  camera?: () => THREE.PerspectiveCamera;
};

// Frame the core of the galaxy, not its outliers: ~8% of blocks are
// unconnected and drift far outside the sphere, and fitting to the true
// bounding box pushes the camera so far back the archive reads as empty again.
const FIT_PERCENTILE = 0.9;

/**
 * How far out the bulk of the graph reaches: the FIT_PERCENTILE-th node
 * distance from the origin. Returns 0 until enough nodes have coordinates.
 */
function coreHalfExtent(nodes: { x?: number; y?: number; z?: number }[]): number {
  const dists = nodes
    .filter((n) => Number.isFinite(n.x) && Number.isFinite(n.y))
    .map((n) => Math.hypot(n.x ?? 0, n.y ?? 0, n.z ?? 0))
    .sort((a, b) => a - b);
  if (dists.length < 8) return 0;
  return dists[Math.floor(FIT_PERCENTILE * (dists.length - 1))] || 0;
}

/**
 * Point the camera so a sphere of `halfExtent` fills the frame, instantly.
 *
 * Hand-rolled rather than `zoomToFit` for three reasons:
 *  1. Any camera move with a transition duration is broken in this stack:
 *     `zoomToFit(ms > 0)` never moves the camera at all, and
 *     `cameraPosition(..., ms > 0)` collapses it onto the origin.
 *  2. The library's `fitToBbox` divides by `Math.atan(...)` where `Math.tan(...)`
 *     belongs, landing the camera roughly twice as far out as it should.
 *  3. It fits the raw bounding box, so a handful of far-flung orphans would
 *     decide the framing for all 900 nodes.
 */
function fitCamera(
  fg: GraphHandle,
  halfExtent: number,
  margin = 1.05
): boolean {
  const camera = fg.camera?.();
  if (!camera || !fg.cameraPosition || halfExtent <= 0) return false;

  const halfFov = ((camera.fov ?? 50) / 2) * (Math.PI / 180);
  const fitHeight = halfExtent / Math.tan(halfFov);
  // Narrow windows are width-constrained, so back off further there.
  const fitWidth = fitHeight / (camera.aspect || 1);
  const dist = Math.max(fitHeight, fitWidth) * margin;
  // A zero-height canvas makes aspect 0/NaN, and feeding NaN to the camera
  // wedges the renderer into a black screen you can't recover from.
  if (!Number.isFinite(dist) || dist <= 0) return false;

  // Keep whatever direction the camera is already looking from, so a refit
  // after the user has spun the map doesn't snap them back to the front.
  const p = camera.position;
  const len = Math.hypot(p.x, p.y, p.z) || 1;
  fg.cameraPosition(
    { x: (p.x / len) * dist, y: (p.y / len) * dist, z: (p.z / len) * dist },
    { x: 0, y: 0, z: 0 },
    0
  );
  return true;
}

export default function KnowledgeGraph({
  items,
  manualEdges = [],
  concepts = [],
  blockConceptLinks = [],
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<GraphHandle | null>(null);
  // Ref attachment doesn't re-render, and the 3D module loads lazily - this
  // flag re-runs the setup effects once the graph instance actually exists.
  const [fgReady, setFgReady] = useState(false);
  // One camera fit per data load, fired when the simulation settles. The fit
  // is applied instantly (see fitCamera): animated camera moves are broken in
  // this stack - `zoomToFit(ms > 0)` silently does nothing and
  // `cameraPosition(..., ms > 0)` collapses the camera onto the origin, which
  // is what used to leave the view "inside the sphere".
  const didFitRef = useRef(false);
  // True once the force layout exists. `d3ReheatSimulation()` only flips the
  // engine's "running" flag (via d3ForceLayout), but the tick loop dereferences
  // a separate `state.layout` that isn't built until the graph has ingested
  // graphData - reheating before then throws "Cannot read properties of
  // undefined (reading 'tick')" inside the animation loop, which kills all
  // rendering and leaves a black canvas. onEngineTick only fires after a
  // successful tick, so it is a safe readiness signal.
  const layoutReadyRef = useRef(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // The node the cursor is over - drives Obsidian-style neighbour highlighting.
  const [hoverId, setHoverId] = useState<string | null>(null);
  // The node whose detail card is open, plus where (within the container) to
  // anchor the card. Cleared by clicking empty space.
  const [selected, setSelected] = useState<{
    node: GraphNode;
    x: number;
    y: number;
  } | null>(null);
  // Click-to-focus: the clicked node stays highlighted (it + its neighbours)
  // until you click empty space - unlike hover, which follows the cursor.
  const [focusId, setFocusId] = useState<string | null>(null);
  // Filters: a positive selection of what to SHOW. Empty = show everything;
  // pick chips and only those stay visible. Keys are channel ids plus the
  // special CONCEPTS_KEY for the concept layer.
  const [shownKeys, setShownKeys] = useState<Set<string>>(() => new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Deep-space ambience, off by default; the AudioContext is only created on
  // the first toggle, which is the user gesture browsers require.
  const [soundOn, setSoundOn] = useState(false);
  const audioRef = useRef<UniverseAudio | null>(null);
  // Blocks with no links at all (no channel, no shared concept, no manual
  // edge) settle on an outer ring - this hides them when they're just noise.
  const [hideUnconnected, setHideUnconnected] = useState(false);
  // Canvas colours can't ride the CSS-var ramp, so resolve them per theme.
  const palette = useThemePalette();

  // A ResizeObserver, not a one-shot measure: the canvas below is gated on a
  // non-zero size, and a container that measures 0x0 at mount (React hides a
  // suspended subtree with display:none, which zeroes getBoundingClientRect)
  // would otherwise stay blank until a window resize or a full reload. Same
  // guard IdeaGarden already uses. Zero readings are ignored rather than
  // stored, so a transient hidden state can't latch a bad size.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      setSize((prev) =>
        prev.w === r.width && prev.h === r.height
          ? prev
          : { w: r.width, h: r.height }
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The graph is curation-driven: every block links to its channel hubs (the
  // primary structure), to the concept hubs it shares (the automatic text
  // layer), and via manual block↔block edges (the curatorial gesture). Blocks
  // are coloured by their primary channel; concepts share one warm accent.
  //
  // Constellation seeding: channel hubs start evenly spaced on a ring, blocks
  // next to their primary hub, concepts near the centre. d3-force is
  // deterministic given fixed starting positions, so the map settles into the
  // same recognisable shape on every visit.
  const data = useMemo<{ nodes: GraphNode[]; links: GraphLink[] }>(() => {
    const validIds = new Set(items.map((i) => i.id));
    const byKey = new Map<string, GraphLink>();

    const nodes: GraphNode[] = items.map((i) => ({
      id: i.id,
      name: i.title,
      category: i.category,
      tags: i.tagNames,
      tagIds: i.tagIds,
      type: "block",
      color: i.tagIds[0] ? channelColor(i.tagIds[0]) : BLOCK_NEUTRAL,
      img: i.img,
    }));

    // One hub per channel, discovered from the blocks themselves.
    const channelMeta = new Map<
      string,
      { name: string; slug: string; count: number }
    >();
    for (const i of items) {
      i.tagIds.forEach((id, idx) => {
        const meta = channelMeta.get(id) ?? {
          name: i.tagNames[idx] ?? "Channel",
          slug: i.tagSlugs[idx] ?? "",
          count: 0,
        };
        meta.count += 1;
        channelMeta.set(id, meta);
      });
    }
    for (const [id, meta] of channelMeta) {
      nodes.push({
        id: channelNodeId(id),
        name: meta.name,
        category: null,
        tags: [],
        // The raw channel id doubles as the filter key, so the existing
        // channel chips show/hide the hub together with its blocks.
        tagIds: [id],
        type: "channel",
        color: channelColor(id),
        slug: meta.slug,
        prevalence: meta.count,
      });
    }

    for (const c of concepts) {
      nodes.push({
        id: conceptNodeId(c.id),
        name: c.term,
        category: null,
        tags: [],
        tagIds: [],
        type: "concept",
        color: CONCEPT_COLOR,
        slug: c.slug,
        prevalence: c.blockCount,
      });
    }

    // Block → channel links: the curation layer, tinted per channel.
    for (const i of items) {
      for (const chId of new Set(i.tagIds)) {
        byKey.set(`ch:${i.id}|${chId}`, {
          source: i.id,
          target: channelNodeId(chId),
          value: 2,
          manual: false,
          kind: "channel",
        });
      }
    }

    const validConcept = new Set(concepts.map((c) => c.id));
    for (const l of blockConceptLinks) {
      if (!validIds.has(l.blockId) || !validConcept.has(l.conceptId)) continue;
      byKey.set(`bc:${l.blockId}|${l.conceptId}`, {
        source: l.blockId,
        target: conceptNodeId(l.conceptId),
        value: 1,
        manual: false,
        kind: "concept",
      });
    }

    const edgeKey = (s: string, t: string) =>
      s < t ? `${s}|${t}` : `${t}|${s}`;
    for (const me of manualEdges) {
      if (!validIds.has(me.a) || !validIds.has(me.b)) continue;
      byKey.set(edgeKey(me.a, me.b), {
        source: me.a,
        target: me.b,
        value: 5,
        manual: true,
        kind: "manual",
      });
    }

    const links = Array.from(byKey.values());

    // Degree centrality - how many edges each node has. Drives node size.
    const deg = new Map<string, number>();
    for (const l of links) {
      deg.set(l.source, (deg.get(l.source) ?? 0) + 1);
      deg.set(l.target, (deg.get(l.target) ?? 0) + 1);
    }
    for (const n of nodes) n.deg = deg.get(n.id) ?? 0;

    // ── sphere seeding ───────────────────────────────────────────────────────
    // Hubs spread evenly over a sphere surface via a fibonacci lattice
    // (alphabetical order, so adding blocks doesn't reshuffle); blocks
    // scatter around their hub, concepts fill an inner ball, orphans dust a
    // wider shell. A forceRadial in the forces effect keeps the shell shape.
    // Deterministic via hash01.
    type Seeded = GraphNode & {
      x?: number;
      y?: number;
      z?: number;
      fx?: number;
      fy?: number;
      fz?: number;
    };
    const hubs = [...channelMeta.keys()].sort((a, b) =>
      (channelMeta.get(a)!.name).localeCompare(channelMeta.get(b)!.name)
    );
    const R = sphereRadius(hubs.length);
    const hubPos = new Map<string, { x: number; y: number; z: number }>();
    hubs.forEach((id, i) => {
      // Fibonacci sphere: uniform-ish coverage for any point count.
      const y = 1 - ((i + 0.5) * 2) / hubs.length;
      const rr = Math.sqrt(Math.max(0, 1 - y * y));
      const phi = i * GOLDEN;
      hubPos.set(id, {
        x: Math.cos(phi) * rr * R,
        y: y * R,
        z: Math.sin(phi) * rr * R,
      });
    });
    // Deterministic unit vector from a node id, for jitter directions.
    const dir = (id: string, salt: number) => {
      const u = hash01(id, salt) * 2 - 1;
      const th = hash01(id, salt + 1) * 2 * Math.PI;
      const s = Math.sqrt(Math.max(0, 1 - u * u));
      return { x: s * Math.cos(th), y: s * Math.sin(th), z: u };
    };
    for (const n of nodes as Seeded[]) {
      if (n.type === "channel") {
        // Hubs are PINNED to their lattice spot: they are the fixed anchor
        // stars that guarantee the sphere shape (links would otherwise drag
        // every cluster into one cap). Dragging a hub re-pins it elsewhere.
        const p = hubPos.get(n.tagIds[0])!;
        n.x = n.fx = p.x;
        n.y = n.fy = p.y;
        n.z = n.fz = p.z;
      } else if (n.type === "concept") {
        // Concepts bridge channels: they fill the inner ball, so the core of
        // the sphere stays alive.
        const v = dir(n.id, 1);
        const d = hash01(n.id, 3) * R * 0.45;
        n.x = v.x * d;
        n.y = v.y * d;
        n.z = v.z * d;
      } else if (n.tagIds[0]) {
        // Blocks scatter around their primary channel's hub.
        const p = hubPos.get(n.tagIds[0]) ?? { x: 0, y: 0, z: 0 };
        const v = dir(n.id, 5);
        const jd = 8 + hash01(n.id, 7) * 24;
        n.x = p.x + v.x * jd;
        n.y = p.y + v.y * jd;
        n.z = p.z + v.z * jd;
      } else {
        // Channel-less blocks dust a wider shell around the sphere.
        const v = dir(n.id, 9);
        const d = R * (1.25 + hash01(n.id, 11) * 0.2);
        n.x = v.x * d;
        n.y = v.y * d;
        n.z = v.z * d;
      }
    }

    return { nodes, links };
  }, [items, concepts, blockConceptLinks, manualEdges]);

  // id → node lookup, used by the filter's link-visibility test.
  const nodeById = useMemo(() => {
    const m = new Map<string, GraphNode>();
    for (const n of data.nodes) m.set(n.id, n);
    return m;
  }, [data]);

  // Distinct primary channels (a block's first channel) for the filter chips.
  // Channel-less blocks collapse into one "No channel" group so they're
  // toggleable too.
  const NO_CHANNEL = "__none__";
  const CONCEPTS_KEY = "__concepts__";
  const channelList = useMemo(() => {
    const m = new Map<string, { id: string; name: string; color: string }>();
    for (const i of items) {
      const id = i.tagIds[0] ?? NO_CHANNEL;
      if (m.has(id)) continue;
      m.set(id, {
        id,
        name: id === NO_CHANNEL ? "No channel" : i.tagNames[0] ?? "Channel",
        color: id === NO_CHANNEL ? BLOCK_NEUTRAL : channelColor(id),
      });
    }
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  // A node passes the filter when nothing is selected (show all) or when its
  // key is in the selection. Channel hubs carry their raw channel id in
  // tagIds[0], so the same chips govern hub and members together. Shared by
  // node + link visibility and focus reset.
  const isNodeVisible = useMemo(() => {
    return (n: GraphNode) => {
      if (hideUnconnected && n.type === "block" && (n.deg ?? 0) === 0) {
        return false;
      }
      if (shownKeys.size === 0) return true;
      if (n.type === "concept") return shownKeys.has(CONCEPTS_KEY);
      const ch = n.tagIds[0] ?? NO_CHANNEL;
      return shownKeys.has(ch);
    };
  }, [shownKeys, hideUnconnected]);

  // If the focused node gets filtered out, ignore the focus so the map doesn't
  // stay dimmed around something you can no longer see. Derived during render
  // rather than reset in an effect (which would cascade an extra render).
  const visibleFocusId = useMemo(() => {
    if (focusId === null) return null;
    const n = nodeById.get(focusId);
    return n && isNodeVisible(n) ? focusId : null;
  }, [focusId, nodeById, isNodeVisible]);

  // Search: type 2+ characters, Enter jumps to (and pins focus on) each match
  // in turn. Matching is a simple case-insensitive substring over node names.
  const [query, setQuery] = useState("");
  const [matchIdx, setMatchIdx] = useState(0);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [] as GraphNode[];
    return data.nodes.filter(
      (n) => isNodeVisible(n) && n.name.toLowerCase().includes(q)
    );
  }, [query, data, isNodeVisible]);

  const jumpToMatch = (idx: number) => {
    const n = matches[idx] as
      | (GraphNode & { x?: number; y?: number; z?: number })
      | undefined;
    if (!n || n.x === undefined || n.y === undefined) return;
    // Searching before the layout settles would otherwise be undone by the
    // settle-fit; claim the fit so the flight below wins.
    didFitRef.current = true;
    // Fly the camera to a point just outside the node, looking at it.
    const z = n.z ?? 0;
    const dist = Math.hypot(n.x, n.y, z) || 1;
    const ratio = 1 + 90 / dist;
    // Instant, not animated: a transition duration here dumps the camera on
    // the origin instead of the node (same library bug fitCamera works around).
    fgRef.current?.cameraPosition?.(
      { x: n.x * ratio, y: n.y * ratio, z: z * ratio + 50 },
      { x: n.x, y: n.y, z },
      0
    );
    setFocusId(n.id);
  };

  // Cross-reference maps for the click card: which concepts a block mentions,
  // which blocks mention a concept, and which blocks live in a channel.
  const { conceptToBlocks, channelToBlocks } = useMemo(() => {
    const conceptById = new Map(concepts.map((c) => [c.id, c]));
    const itemById = new Map(items.map((i) => [i.id, i]));
    const b2c = new Map<string, GraphConcept[]>();
    const c2b = new Map<string, GraphItem[]>();
    for (const l of blockConceptLinks) {
      const c = conceptById.get(l.conceptId);
      const it = itemById.get(l.blockId);
      if (!c || !it) continue;
      if (!b2c.has(l.blockId)) b2c.set(l.blockId, []);
      b2c.get(l.blockId)!.push(c);
      if (!c2b.has(l.conceptId)) c2b.set(l.conceptId, []);
      c2b.get(l.conceptId)!.push(it);
    }
    const ch2b = new Map<string, GraphItem[]>();
    for (const it of items) {
      for (const chId of it.tagIds) {
        if (!ch2b.has(chId)) ch2b.set(chId, []);
        ch2b.get(chId)!.push(it);
      }
    }
    return { blockToConcepts: b2c, conceptToBlocks: c2b, channelToBlocks: ch2b };
  }, [items, concepts, blockConceptLinks]);

  // Radius of the shell the channel hubs settle on. Drives the radial force,
  // the fog range, and the camera fit's "has the layout spread yet?" check.
  const sphereR = useMemo(
    () => sphereRadius(data.nodes.filter((n) => n.type === "channel").length),
    [data]
  );

  // Neo4j-style "magnet": strong, short links pull connected nodes into tight
  // clusters, while only mild repulsion keeps them from overlapping and light
  // gravity holds the whole map together. The previous strong-repulsion /
  // weak-link mix strung everything out - this flips that ratio so groups clump.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || size.w === 0) return;

    const charge = fg.d3Force("charge");
    if (charge?.strength) charge.strength(-45);
    const link = fg.d3Force("link");
    // Channel links are the structural layer: strong, with spoke length
    // scaled to the hub's size so a 90-block channel gets a proportionally
    // bigger orbit than a 5-block one (uniform distances read as random).
    // Concept links barely pull - they're context, and letting them tug
    // dragged clusters into each other. Manual edges pull hardest.
    if (link?.distance)
      link.distance((l: unknown) => {
        const gl = l as GraphLink;
        if (gl.kind === "manual") return 18;
        if (gl.kind === "concept") return 40;
        // By simulation time d3 has replaced the id string with the node.
        const target = gl.target as unknown;
        const hubDeg =
          typeof target === "object" && target
            ? (target as { deg?: number }).deg ?? 1
            : 1;
        return 14 + Math.sqrt(hubDeg) * 2.4;
      });
    if (link?.strength)
      link.strength((l: unknown) => {
        const k = (l as GraphLink).kind;
        return k === "channel" ? 0.8 : k === "manual" ? 0.7 : 0.05;
      });
    // Dust packs tight: much smaller personal space than the old discs, so
    // clusters read as dense sparkling puffs instead of spaced-out balls.
    fg.d3Force(
      "collide",
      forceCollide()
        .radius((n: { deg?: number }) => nodeRadius(n) * 0.5 + 1.5)
        .strength(0.9)
    );
    // Clear the old planar-gravity forces (matters during hot reload, when
    // the running simulation survives the code swap).
    fg.d3Force("x", null);
    fg.d3Force("y", null);
    fg.d3Force("z", null);
    // The sphere keeper: pull channel hubs and their blocks toward a shell
    // of radius R, concepts toward an inner ball, so the archive holds its
    // planet shape instead of collapsing into a blob or a plane.
    const R = sphereR;
    fg.d3Force(
      "radial",
      forceRadial((n: unknown) =>
        (n as GraphNode).type === "concept" ? R * 0.45 : R
      ).strength(0.3)
    );

    // Only safe once the layout exists (see layoutReadyRef). Skipping it on
    // first mount costs nothing: the graph runs its own warmup/cooldown when
    // it ingests graphData, and the forces set above are picked up by that run.
    if (layoutReadyRef.current) fg.d3ReheatSimulation?.();
    didFitRef.current = false; // allow one fresh camera fit per data load
  }, [data, size.w, fgReady, sphereR]);

  // Keep the camera framed while the layout settles.
  //
  // Deliberately a per-frame track rather than a one-shot on `onEngineStop`:
  // the engine reports a stop while the nodes are still stacked near the
  // origin, and fitting at that moment parks the camera inside the cloud.
  // Rather than trying to detect "settled" (the spread creeps for a while and
  // never fully stops), just re-frame every frame for a few seconds, which
  // reads as a gentle zoom-out and is correct whenever the layout finishes.
  // Any interaction hands control straight back to the visitor.
  useEffect(() => {
    const fg = fgRef.current;
    const el = containerRef.current;
    if (!fg || !el || size.w === 0) return;

    let raf = 0;
    let frames = 0;
    const release = () => {
      didFitRef.current = true;
      cancelAnimationFrame(raf);
    };

    const track = () => {
      // ~6s of visible time (rAF pauses in background tabs, which is fine -
      // it resumes and finishes framing when the tab is looked at).
      if (didFitRef.current || frames++ > 360) return release();
      const half = coreHalfExtent(data.nodes);
      // Wait until the layout has actually reached its shell before touching
      // the camera. Fitting a half-formed cloud puts the camera among the
      // nodes, which renders as a black screen for a beat after switching in.
      // Until then the library's own default distance keeps everything in view.
      if (half >= sphereR * 0.9) fitCamera(fg, half);
      raf = requestAnimationFrame(track);
    };
    raf = requestAnimationFrame(track);

    el.addEventListener("pointerdown", release);
    el.addEventListener("wheel", release, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointerdown", release);
      el.removeEventListener("wheel", release);
    };
  }, [data, size.w, fgReady, sphereR]);

  // Galaxy dressing, once the 3D scene exists: a matte starfield shell far
  // behind the graph (flat points, NO glow/bloom - hard rule) plus the fog
  // depth cue below.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || size.w === 0) return;

    const scene = fg.scene?.();
    if (scene && !scene.getObjectByName("starfield")) {
      const N = 1200;
      const pos = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        // Uniform direction, distance well beyond the graph so stars never
        // mix with nodes while orbiting.
        const u = hash01(String(i), 7) * 2 - 1;
        const th = hash01(String(i), 8) * 2 * Math.PI;
        const r = 1600 + hash01(String(i), 9) * 1800;
        const s = Math.sqrt(1 - u * u);
        pos[i * 3] = s * Math.cos(th) * r;
        pos[i * 3 + 1] = s * Math.sin(th) * r;
        pos[i * 3 + 2] = u * r;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({
        // The dust texture keeps these round: untextured points render as
        // squares, which becomes obvious above ~2px.
        map: dustTexture(),
        color: 0xa8a8b2,
        size: 1.8,
        sizeAttenuation: false, // constant screen size, so stars read as stars at any zoom
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        fog: false, // deep space stays visible behind the fogged orb
      });
      const stars = new THREE.Points(geo, mat);
      stars.name = "starfield";
      scene.add(stars);
    }

    // Depth cue: aerial-perspective fog, which is what makes the archive read
    // as a solid sphere rather than a flat scatter. Nodes recede toward the
    // background the further they sit from the camera, so the far hemisphere
    // sinks away and dust re-emerges as it rotates toward you. This is a matte
    // fade to the page colour, NOT a glow: nothing is ever brightened, only
    // dimmed. Re-tied to the camera distance every frame, since a fixed range
    // over-fogs when zoomed out and under-fogs up close.
    //
    // The band is deliberately narrow: it spans the sphere itself (front pole
    // clear, back pole almost gone) instead of trailing far past it, which is
    // what previously flattened the depth out to a barely-visible gradient.
    // The hub shell sits at sphereR, but blocks and orphans scatter well past
    // it, so the effective radius is ~1.35x.
    const R = sphereR * 1.35;
    if (scene && !scene.fog) {
      scene.fog = new THREE.Fog(new THREE.Color(palette.bg), 800, 3000);
    }
    let fogRaf = 0;
    const updateFog = () => {
      fogRaf = requestAnimationFrame(updateFog);
      const cam = fg.camera?.();
      const f = fg.scene?.()?.fog as THREE.Fog | undefined;
      if (!cam || !f) return;
      const dist = cam.position.length();
      f.near = Math.max(30, dist - R * 0.95); // front of the sphere: full colour
      f.far = dist + R * 1.05; // back of the sphere: almost fully sunk into the bg
    };
    updateFog();

    // (No auto-orbit: the graph runs TrackballControls, which has no
    // autoRotate. The assignment that used to live here was inert - the map
    // has never actually rotated on its own.)

    return () => {
      cancelAnimationFrame(fogRaf);
      const sc = fg.scene?.();
      if (sc) sc.fog = null;
      const stars = sc?.getObjectByName("starfield") as THREE.Points | undefined;
      if (stars) {
        sc?.remove(stars);
        stars.geometry.dispose();
        (stars.material as THREE.Material).dispose();
      }
    };
  }, [data, size.w, fgReady, palette.bg, sphereR]);

  // Start/stop the ambience when the toggle flips.
  useEffect(() => {
    if (soundOn && !audioRef.current) audioRef.current = startUniverseAudio();
    else if (!soundOn && audioRef.current) {
      audioRef.current.stop();
      audioRef.current = null;
    }
  }, [soundOn]);

  // Silence it when the Map unmounts (e.g. switching to Garden or Concepts),
  // otherwise the drone keeps playing over the other views.
  useEffect(
    () => () => {
      audioRef.current?.stop();
      audioRef.current = null;
    },
    []
  );

  // Dev-only escape hatch: the graph handle on window, for scene/camera
  // inspection from the console (stripped from production bundles).
  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      (window as unknown as Record<string, unknown>).__kg = fgRef.current;
    }
  });

  // Hover follows the cursor; click "pins" a focus. Hover wins while active so
  // you can still peek at other nodes without losing your pinned selection.
  const activeId = hoverId ?? visibleFocusId;
  const anyFilter = shownKeys.size > 0;

  return (
    <div ref={containerRef} className="relative h-[calc(100vh-3rem)] w-full">
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 text-xs text-neutral-600">
        {data.nodes.length} nodes · {data.links.length} links
      </div>

      {/* Search: jump the camera to matching nodes, Enter cycles through. */}
      <div className="absolute right-3 top-3 z-20 flex items-center gap-2 text-xs">
        {query.trim().length >= 2 && (
          <span className="text-neutral-500">
            {matches.length === 0
              ? "no match"
              : `${(matchIdx % matches.length) + 1} / ${matches.length}`}
          </span>
        )}
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setMatchIdx(0); // new query, start cycling from the first match
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && matches.length > 0) {
              jumpToMatch(matchIdx % matches.length);
              setMatchIdx((i) => (i + 1) % matches.length);
            } else if (e.key === "Escape") {
              setQuery("");
              setFocusId(null);
            }
          }}
          placeholder="Search the map"
          className="w-44 rounded-full border border-neutral-800 bg-neutral-900/70 px-3 py-1 text-neutral-200 placeholder:text-neutral-600 backdrop-blur focus:border-neutral-500 focus:outline-none"
        />
      </div>

      {/* Filter panel: pick chips to SELECT what's visible (empty = show all).
          Uses the graph's visibility accessors, so toggling never re-runs the
          layout. */}
      <div className="absolute left-3 top-3 z-20 text-xs">
        {/* Stacked, not side by side: the view switcher is centred, and a
            second pill on this row collides with it on narrower windows. */}
        <div className="flex flex-col items-start gap-2">
          <button
            type="button"
            onClick={() => setFiltersOpen((o) => !o)}
            className="rounded-full border border-neutral-800 bg-neutral-900/70 px-3 py-1 text-neutral-300 backdrop-blur transition-colors hover:text-neutral-100"
          >
            Filters
            {anyFilter && (
              <span className="ml-1 text-neutral-500">· {shownKeys.size}</span>
            )}
          </button>
          {/* Deep-space ambience, mirroring the Garden's sound toggle. */}
          <button
            type="button"
            onClick={() => setSoundOn((v) => !v)}
            aria-pressed={soundOn}
            className={`rounded-full border border-neutral-800 bg-neutral-900/70 px-3 py-1 backdrop-blur transition-colors ${
              soundOn
                ? "text-neutral-100"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {soundOn ? "Sound on" : "Sound off"}
          </button>
        </div>
        {filtersOpen && (
          <div className="mt-2 max-h-[60vh] w-56 overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-950/95 p-2 shadow-xl backdrop-blur-md">
            <div className="mb-1 flex items-center justify-between px-1">
              <span className="text-neutral-500">
                {anyFilter ? "Showing selected" : "Showing all"}
              </span>
              {anyFilter && (
                <button
                  type="button"
                  onClick={() => setShownKeys(new Set())}
                  className="text-neutral-500 hover:text-neutral-200"
                >
                  Show all
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setHideUnconnected((v) => !v)}
              className="mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-neutral-900"
            >
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-sm border ${
                  hideUnconnected
                    ? "border-neutral-300 bg-neutral-300"
                    : "border-neutral-600"
                }`}
              />
              <span
                className={hideUnconnected ? "text-neutral-100" : "text-neutral-400"}
              >
                Hide unconnected blocks
              </span>
            </button>
            {(() => {
              const toggle = (key: string) =>
                setShownKeys((prev) => {
                  const next = new Set(prev);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  return next;
                });
              // "on" = will render. When nothing is selected everything is on;
              // once a selection exists, unselected chips read as excluded.
              const chip = (
                key: string,
                name: string,
                color: string,
                bold?: boolean
              ) => {
                const on = shownKeys.size === 0 || shownKeys.has(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggle(key)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-neutral-900"
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: color, opacity: on ? 1 : 0.25 }}
                    />
                    <span
                      className={`truncate ${bold ? "font-semibold " : ""}${
                        on ? "text-neutral-100" : "text-neutral-600"
                      }`}
                    >
                      {name}
                    </span>
                  </button>
                );
              };
              return (
                <>
                  {chip(CONCEPTS_KEY, "Concepts", CONCEPT_COLOR, true)}
                  {channelList.map((c) => chip(c.id, c.name, c.color))}
                </>
              );
            })()}
          </div>
        )}
      </div>
      {/* No onEngineStop handler: framing is handled by the camera-track
          effect above. The engine reports "stopped" while the nodes are still
          bunched at the origin, and re-arms itself on any React render, so it
          isn't a trustworthy trigger for the fit. */}
      {size.w > 0 && size.h > 0 && (
        <ForceGraph3D
          ref={(inst: unknown) => {
            fgRef.current = inst as (typeof fgRef)["current"];
            // A new instance has a fresh, not-yet-built layout.
            if (!inst) layoutReadyRef.current = false;
            if (inst) setFgReady(true);
          }}
          graphData={data}
          width={size.w}
          height={size.h}
          backgroundColor={palette.bg}
          showNavInfo={false}
          warmupTicks={30}
          cooldownTicks={250}
          onEngineTick={() => {
            // Fires only after a successful layout tick, so the force layout
            // is now safe to reheat.
            layoutReadyRef.current = true;
          }}
          d3VelocityDecay={0.3}
          enableNodeDrag={true}
          onNodeDragEnd={(raw: unknown) => {
            // Pin the node where it's dropped (Obsidian-style) so it stays put
            // while the rest of the graph keeps reacting around it.
            const n = raw as GraphNode & {
              x?: number;
              y?: number;
              z?: number;
              fx?: number;
              fy?: number;
              fz?: number;
            };
            n.fx = n.x;
            n.fy = n.y;
            n.fz = n.z;
          }}
          onNodeHover={(raw: unknown) => {
            const n = raw as GraphNode | null;
            setHoverId(n ? n.id : null);
          }}
          linkVisibility={(raw: unknown) => {
            const l = raw as GraphLink;
            const touchesActive =
              activeId !== null &&
              (linkEndId(l.source) === activeId ||
                linkEndId(l.target) === activeId);
            // Concept cross-ties are the tangle: in 3D they only appear
            // around the node you're hovering/inspecting.
            if (l.kind === "concept" && !touchesActive) return false;
            if (!anyFilter) return true;
            const s = nodeById.get(linkEndId(l.source));
            const t = nodeById.get(linkEndId(l.target));
            return !!s && !!t && isNodeVisible(s) && isNodeVisible(t);
          }}
          linkColor={(raw: unknown) => {
            const l = raw as GraphLink;
            if (activeId) {
              const touches =
                linkEndId(l.source) === activeId ||
                linkEndId(l.target) === activeId;
              if (!touches) return `rgba(${palette.inkRGB},0.03)`;
              return l.kind === "manual"
                ? `rgba(${palette.inkRGB},0.6)`
                : `rgba(${palette.inkRGB},0.42)`;
            }
            // Whisper-faint grey at rest, cozy.im style.
            return l.kind === "manual"
              ? `rgba(${palette.inkRGB},0.24)`
              : `rgba(${palette.inkRGB},0.09)`;
          }}
          linkOpacity={1}
          onNodeClick={(raw: unknown, event: unknown) => {
            const node = raw as GraphNode;
            const ev = event as MouseEvent;
            const rect = containerRef.current?.getBoundingClientRect();
            // Pin focus on this node (dims all but it + neighbours) and open
            // its detail card.
            setFocusId(node.id);
            setSelected({
              node,
              x: rect ? ev.clientX - rect.left : 0,
              y: rect ? ev.clientY - rect.top : 0,
            });
          }}
          onBackgroundClick={() => {
            setSelected(null);
            setFocusId(null);
          }}
          nodeVisibility={(raw: unknown) => isNodeVisible(raw as GraphNode)}
          nodeLabel={(raw: unknown) => {
            const n = raw as GraphNode;
            return `<div style="font:12px Inter,system-ui,sans-serif;padding:3px 8px;border-radius:8px;background:rgba(12,12,14,0.88);color:#e5e5ea;max-width:260px">${escapeHTML(
              n.name
            )}</div>`;
          }}
          nodeThreeObject={renderNodeObject}
        />
      )}

      {selected &&
        (() => {
          const node = selected.node;
          const isConcept = node.type === "concept";
          const isChannel = node.type === "channel";
          const rawConceptId = isConcept
            ? node.id.replace(/^concept:/, "")
            : null;
          const conceptBlocks =
            isConcept && rawConceptId
              ? conceptToBlocks.get(rawConceptId) ?? []
              : [];
          const channelBlocks = isChannel
            ? channelToBlocks.get(node.tagIds[0]) ?? []
            : [];
          const CARD_W = 268;
          const left = Math.max(
            8,
            Math.min(selected.x + 14, size.w - CARD_W - 8)
          );
          const top = Math.max(8, Math.min(selected.y + 14, size.h - 260));
          return (
            <div
              className="pointer-events-auto absolute z-20 rounded-2xl border border-neutral-800 bg-neutral-950/90 p-4 text-xs shadow-xl backdrop-blur-xl"
              style={{ left, top, width: CARD_W }}
            >
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="absolute right-2.5 top-2 text-base leading-none text-neutral-600 hover:text-neutral-300"
                aria-label="Close"
              >
                ×
              </button>

              {isChannel ? (
                <>
                  <div
                    className="mb-1 pr-4 text-sm font-semibold"
                    style={{ color: node.color }}
                  >
                    {node.name}
                  </div>
                  <div className="mb-3 text-neutral-500">
                    {channelBlocks.length} block
                    {channelBlocks.length === 1 ? "" : "s"} in this channel
                  </div>
                  {(() => {
                    // 2x2 preview grid: the channel's first four blocks that
                    // carry an image, each a clickable thumb.
                    const thumbs = channelBlocks
                      .filter((b) => b.img)
                      .slice(0, 4);
                    if (thumbs.length === 0) return null;
                    return (
                      <div className="mb-3 grid grid-cols-2 gap-1.5">
                        {thumbs.map((b) => (
                          <Link key={b.id} href={`/block/${b.id}`}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={b.img!}
                              alt={b.title || ""}
                              className="h-16 w-full rounded-md object-cover transition-opacity hover:opacity-80"
                            />
                          </Link>
                        ))}
                      </div>
                    );
                  })()}
                  {channelBlocks.length > 0 && (
                    <ul className="mb-3 space-y-1">
                      {channelBlocks.slice(0, 4).map((b) => (
                        <li key={b.id} className="truncate">
                          <Link
                            href={`/block/${b.id}`}
                            className="text-neutral-300 hover:text-neutral-100 hover:underline"
                          >
                            {b.title || "Untitled"}
                          </Link>
                        </li>
                      ))}
                      {channelBlocks.length > 4 && (
                        <li className="text-neutral-600">
                          +{channelBlocks.length - 4} more
                        </li>
                      )}
                    </ul>
                  )}
                  {node.slug && (
                    <Link
                      href={`/channel/${node.slug}`}
                      className="inline-flex items-center rounded-full bg-neutral-100 px-3 py-1 font-medium text-neutral-900 transition-colors hover:bg-white"
                    >
                      Open channel →
                    </Link>
                  )}
                </>
              ) : isConcept ? (
                <>
                  <div
                    className="mb-1 pr-4 text-sm font-semibold"
                    style={{ color: CONCEPT_HEX }}
                  >
                    {node.name}
                  </div>
                  <div className="mb-3 text-neutral-500">
                    {(node.prevalence ?? conceptBlocks.length)} block
                    {(node.prevalence ?? conceptBlocks.length) === 1
                      ? ""
                      : "s"}{" "}
                    mention this
                  </div>
                  {conceptBlocks.length > 0 && (
                    <ul className="mb-3 space-y-1">
                      {conceptBlocks.slice(0, 6).map((b) => (
                        <li key={b.id} className="truncate">
                          <Link
                            href={`/block/${b.id}`}
                            className="text-neutral-300 hover:text-neutral-100 hover:underline"
                          >
                            {b.title || "Untitled"}
                          </Link>
                        </li>
                      ))}
                      {conceptBlocks.length > 6 && (
                        <li className="text-neutral-600">
                          +{conceptBlocks.length - 6} more
                        </li>
                      )}
                    </ul>
                  )}
                  {node.slug && (
                    <Link
                      href={`/concept/${node.slug}`}
                      className="inline-flex items-center rounded-full bg-neutral-100 px-3 py-1 font-medium text-neutral-900 transition-colors hover:bg-white"
                    >
                      Open concept →
                    </Link>
                  )}
                </>
              ) : (
                <>
                  {node.img && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={node.img}
                      alt=""
                      className="mb-2.5 h-32 w-full rounded-lg object-cover"
                    />
                  )}
                  <div className="mb-2 pr-4 text-sm font-semibold leading-snug text-neutral-100">
                    {node.name}
                  </div>
                  {node.tags.length > 0 && (
                    <div className="mb-3 flex flex-wrap gap-1">
                      {node.tags.slice(0, 4).map((t, i) => (
                        <span
                          key={t}
                          className="flex items-center gap-1.5 rounded-full bg-neutral-900 px-2 py-0.5 text-neutral-300"
                        >
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{
                              background: node.tagIds[i]
                                ? channelColor(node.tagIds[i])
                                : BLOCK_NEUTRAL,
                            }}
                          />
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  <Link
                    href={`/block/${node.id}`}
                    className="inline-flex items-center rounded-full bg-neutral-100 px-3 py-1 font-medium text-neutral-900 transition-colors hover:bg-white"
                  >
                    Open block →
                  </Link>
                </>
              )}
            </div>
          );
        })()}
    </div>
  );
}
