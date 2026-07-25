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

export default function KnowledgeGraph({
  items,
  manualEdges = [],
  concepts = [],
  blockConceptLinks = [],
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<{
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
    zoomToFit?: (ms?: number, padding?: number) => void;
    cameraPosition?: (
      pos: { x: number; y: number; z: number },
      lookAt?: { x: number; y: number; z: number },
      ms?: number
    ) => void;
    controls?: () => {
      autoRotate?: boolean;
      autoRotateSpeed?: number;
      addEventListener?: (ev: string, cb: () => void) => void;
    };
    scene?: () => THREE.Scene;
  } | null>(null);
  // Ref attachment doesn't re-render, and the 3D module loads lazily - this
  // flag re-runs the setup effects once the graph instance actually exists.
  const [fgReady, setFgReady] = useState(false);
  // One camera fit per data load, fired when the simulation settles (the
  // timer-based fit raced the lazy module + intro overlay and could leave
  // the camera inside the sphere).
  const didFitRef = useRef(false);
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
  // Blocks with no links at all (no channel, no shared concept, no manual
  // edge) settle on an outer ring - this hides them when they're just noise.
  const [hideUnconnected, setHideUnconnected] = useState(false);
  // Canvas colours can't ride the CSS-var ramp, so resolve them per theme.
  const palette = useThemePalette();

  useEffect(() => {
    function onResize() {
      if (!containerRef.current) return;
      const r = containerRef.current.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    }
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
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

  // If the focused node gets filtered out, drop the focus so the map doesn't
  // stay dimmed around something you can no longer see.
  useEffect(() => {
    if (focusId === null) return;
    const n = nodeById.get(focusId);
    if (!n || !isNodeVisible(n)) setFocusId(null);
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
  useEffect(() => setMatchIdx(0), [query]);

  const jumpToMatch = (idx: number) => {
    const n = matches[idx] as
      | (GraphNode & { x?: number; y?: number; z?: number })
      | undefined;
    if (!n || n.x === undefined || n.y === undefined) return;
    // Fly the camera to a point just outside the node, looking at it.
    const z = n.z ?? 0;
    const dist = Math.hypot(n.x, n.y, z) || 1;
    const ratio = 1 + 90 / dist;
    fgRef.current?.cameraPosition?.(
      { x: n.x * ratio, y: n.y * ratio, z: z * ratio + 50 },
      { x: n.x, y: n.y, z },
      1200
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
    const R = sphereRadius(
      data.nodes.filter((n) => n.type === "channel").length
    );
    fg.d3Force(
      "radial",
      forceRadial((n: unknown) =>
        (n as GraphNode).type === "concept" ? R * 0.45 : R
      ).strength(0.3)
    );

    fg.d3ReheatSimulation?.();
    didFitRef.current = false; // allow one fresh camera fit per data load
  }, [data, size.w, fgReady]);

  // Galaxy dressing + motion, once the 3D scene exists: a matte starfield
  // shell far behind the graph (tiny flat points, NO glow/bloom - hard rule),
  // and a slow auto-orbit that stops the moment you grab the view.
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
        color: 0x84848c,
        size: 1.2,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.3,
      });
      const stars = new THREE.Points(geo, mat);
      stars.name = "starfield";
      scene.add(stars);
    }

    // Celestial wireframe: faint meridians + parallels at the shell radius,
    // so the dust cloud unmistakably reads as an orb (thin matte lines, the
    // same language as the garden's line-art; no glow). Rotates with the
    // scene, giving a strong 3D cue while orbiting.
    if (scene && !scene.getObjectByName("spheregrid")) {
      const globe = new THREE.Group();
      globe.name = "spheregrid";
      const R =
        sphereRadius(data.nodes.filter((n) => n.type === "channel").length) *
        1.04; // sit just outside the dust shell
      const gridMat = new THREE.LineBasicMaterial({
        color: 0x9a9aa4,
        transparent: true,
        opacity: 0.16,
      });
      const circle = (radius: number, segments = 96) => {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i < segments; i++) {
          const a = (i / segments) * 2 * Math.PI;
          pts.push(new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0));
        }
        return new THREE.BufferGeometry().setFromPoints(pts);
      };
      // Meridians: great circles through the poles, fanned around Y.
      for (let k = 0; k < 6; k++) {
        const line = new THREE.LineLoop(circle(R), gridMat);
        line.rotation.y = (k / 6) * Math.PI;
        globe.add(line);
      }
      // Parallels: latitude rings, equator strongest by being longest.
      for (const lat of [-60, -30, 0, 30, 60]) {
        const rad = (lat * Math.PI) / 180;
        const line = new THREE.LineLoop(circle(R * Math.cos(rad)), gridMat);
        line.rotation.x = Math.PI / 2; // lie flat in the XZ plane
        line.position.y = R * Math.sin(rad);
        globe.add(line);
      }
      scene.add(globe);
    }

    const controls = fg.controls?.();
    if (controls) {
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.4;
      controls.addEventListener?.("start", () => {
        controls.autoRotate = false;
      });
    }

    return () => {
      const sc = fg.scene?.();
      const stars = sc?.getObjectByName("starfield") as THREE.Points | undefined;
      if (stars) {
        sc?.remove(stars);
        stars.geometry.dispose();
        (stars.material as THREE.Material).dispose();
      }
      const globe = sc?.getObjectByName("spheregrid") as THREE.Group | undefined;
      if (globe) {
        sc?.remove(globe);
        const mats = new Set<THREE.Material>();
        globe.traverse((o) => {
          const line = o as THREE.LineLoop;
          if (line.geometry) line.geometry.dispose();
          if (line.material) mats.add(line.material as THREE.Material);
        });
        mats.forEach((m) => m.dispose());
      }
    };
  }, [data, size.w, fgReady]);

  // Dev-only escape hatch: the graph handle on window, for scene/camera
  // inspection from the console (stripped from production bundles).
  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      (window as unknown as Record<string, unknown>).__kg = fgRef.current;
    }
  });

  // Hover follows the cursor; click "pins" a focus. Hover wins while active so
  // you can still peek at other nodes without losing your pinned selection.
  const activeId = hoverId ?? focusId;
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
          onChange={(e) => setQuery(e.target.value)}
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
      {size.w > 0 && size.h > 0 && (
        <ForceGraph3D
          ref={(inst: unknown) => {
            fgRef.current = inst as (typeof fgRef)["current"];
            if (inst) setFgReady(true);
          }}
          graphData={data}
          width={size.w}
          height={size.h}
          backgroundColor={palette.bg}
          showNavInfo={false}
          warmupTicks={30}
          cooldownTicks={250}
          onEngineStop={() => {
            if (didFitRef.current) return;
            didFitRef.current = true;
            fgRef.current?.zoomToFit?.(800, 70);
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
          nodeThreeObject={(raw: unknown) => {
            // Fine translucent particles, striking-and-mysterious style: flat
            // billboard discs in the node's channel colour with real opacity,
            // so overlapping particles build density instead of solid balls.
            // Blocks are small dust, hubs are larger soft blobs, concepts sit
            // between. Channel names float above their hub; other names show
            // in the hover tooltip. Flat matte throughout - no glow.
            const n = raw as GraphNode;
            const isHub = n.type === "channel";
            const isConcept = n.type === "concept";
            const r = 4 * Math.cbrt(Math.min(60, Math.max(1, n.deg ?? 1)));
            // Stardust scale: blocks are tiny motes, hubs stay modest and let
            // their floating label do the identifying. Density comes from many
            // overlapping specks, not from big shapes.
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
            const label =
              n.name.length > 28 ? n.name.slice(0, 26) + "…" : n.name;
            const text = new SpriteText(label);
            text.textHeight = 6.5;
            text.color = "#d6d6dc";
            text.fontWeight = "600";
            text.fontFace = "Inter, system-ui, sans-serif";
            text.material.depthWrite = false;
            text.position.y = d / 2 + 7;
            group.add(text);
            return group;
          }}
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
