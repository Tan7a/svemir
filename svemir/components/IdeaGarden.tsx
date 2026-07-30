"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildPlant, mulberry32, seedFromId } from "@/lib/lsystem";
import { pickSpecies, speciesParams } from "@/lib/tree-species";
import { inkOn } from "@/lib/constants";
import {
  IconPlay,
  IconPause,
  IconSoundOn,
  IconSoundOff,
} from "@/components/ui/icons";

export type GardenLeaf = { id: string; title: string; createdAt: string };
export type GardenChannel = {
  id: string;
  slug: string;
  title: string;
  /** The channel's brand colour (hex). */
  color: string;
  leaves: GardenLeaf[];
};

/** One shared term carried by a root; links to /concept/[slug]. */
export type RootTerm = { term: string; slug: string };

/**
 * A concept connection between two channels, drawn as an organic root curve
 * under the soil line. Computed by the channel_concept_pairs RPC (0013) and
 * shaped in app/graph/page.tsx.
 */
export type GardenRoot = {
  /** Channel id of one endpoint. */
  a: string;
  /** Channel id of the other endpoint. */
  b: string;
  /** 0..1, normalized against the strongest pair by the page. */
  weight: number;
  sharedCount: number;
  terms: RootTerm[];
};

// Stable default: a fresh [] literal per render would change the effect deps
// and rebuild the whole WebGL scene on every parent re-render.
const NO_ROOTS: GardenRoot[] = [];

type Props = {
  gardens: GardenChannel[];
  roots?: GardenRoot[];
  /** Root clicked: open the shell panel on that pair. Read via ref, not deps. */
  onRootSelect?: (root: GardenRoot) => void;
  /** Trunk/branch clicked: open the shell panel on that channel. Via ref too. */
  onTreeSelect?: (channelId: string) => void;
};

const GOLDEN = 137.50776405003785 * (Math.PI / 180);
const SVG_NS = "http://www.w3.org/2000/svg";

/** Per-plant render handle, used by the animation loop for the scrubber + labels. */
type PlantView = {
  channel: GardenChannel;
  group: THREE.Group;
  inst: THREE.InstancedMesh;
  n: number; // full leaf count
  dates: number[]; // leaf created_at in ms, ascending (oldest→newest)
  height: number; // full plant height (world units, before growth scaling)
  pill: HTMLDivElement; // edge label
  line: SVGLineElement; // leader line to the plant
  // ── label layout, rewritten every frame by updateLabels ─────────────────────
  sx: number; // last projected anchor screen x (pill centre)
  sy: number; // last projected anchor screen y (pill bottom, before any lift)
  cx: number; // last projected crown-top screen x (where the leader line ends)
  cy: number; // last projected crown-top screen y
  /** Measured pill box, cached at build so the layout pass never reads layout. */
  pw: number;
  ph: number;
  /** Pixels this pill must rise to clear its neighbours, and the eased value. */
  lift: number;
  liftEased: number;
  /** Screen y of the pill's bottom edge as actually drawn; what pillAt tests. */
  drawY: number;
  /** False while the tree is scrubbed out: no pill, no line, no hit test. */
  labelOn: boolean;
};

/**
 * Per-root render handle. One LineSegments carries every strand of the root
 * (thicker pairs = more parallel strands, since linewidth is a no-op on
 * WebGL), with its OWN material so each root can ease its opacity toward its
 * hover target without touching the others.
 */
type RootView = {
  root: GardenRoot;
  line: THREE.LineSegments;
  mat: THREE.LineBasicMaterial;
  /** Anchor dots at both trunk bases: the visible click targets. */
  dots: THREE.Points;
  dotMat: THREE.PointsMaterial;
  pvA: PlantView;
  pvB: PlantView;
  /** Rest opacity, scaled by the pair's weight. */
  baseOpacity: number;
  /** Current opacity, eased per frame toward the hover-aware target. */
  opacity: number;
  /** World point of the deepest dip; anchors the hover tooltip. */
  mid: THREE.Vector3;
};

/**
 * Idea Garden - each channel grows into a thin, pale L-system plant (a bare stem
 * under a rounded crown of leaves; blocks = leaves, oldest at the base, newest at
 * the tip). Plants stand on an invisible ground dusted with faint specks; channel
 * names sit at the screen edges with thin leader lines. A timeline scrubber grows
 * the whole garden by `created_at`.
 *
 * Pure Three.js. Flat matte materials - NO bloom/glow, NO gradients. The entire
 * scene + overlay DOM is built in one effect and fully torn down on cleanup so it
 * is safe under React StrictMode's dev double-mount.
 *
 * Visual inspiration: poetengineer (https://x.com/poetengineer__). This is an
 * original, from-scratch implementation - inspiration only, no copied code.
 */
type ForestAudio = { stop: () => void };

// Procedural forest ambience (Web Audio, no external asset): a soft wind bed
// (brownish noise through a slowly-modulated lowpass) + occasional synthesized
// birdsong that echoes the on-screen birds. Created on a user gesture (the Sound
// toggle), so it satisfies browser autoplay rules. Fades in/out gently.
function startForestAudio(): ForestAudio {
  const ctx = new AudioContext();
  void ctx.resume();
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  const t0 = ctx.currentTime;
  master.gain.setValueAtTime(0, t0);
  master.gain.linearRampToValueAtTime(0.5, t0 + 1.5); // gentle fade-in

  // Wind bed: 2s of brownish noise, looped.
  const len = Math.floor(2 * ctx.sampleRate);
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02; // integrate -> brown-ish (soft, low)
    data[i] = last * 3.2;
  }
  const wind = ctx.createBufferSource();
  wind.buffer = buffer;
  wind.loop = true;
  const windFilter = ctx.createBiquadFilter();
  windFilter.type = "lowpass";
  windFilter.frequency.value = 480;
  const windGain = ctx.createGain();
  windGain.gain.value = 0.22;
  wind.connect(windFilter).connect(windGain).connect(master);
  wind.start();

  // Slow LFOs so the wind breathes (filter sweep + gain swell).
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.06;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 220;
  lfo.connect(lfoGain).connect(windFilter.frequency);
  const lfo2 = ctx.createOscillator();
  lfo2.frequency.value = 0.09;
  const lfo2Gain = ctx.createGain();
  lfo2Gain.gain.value = 0.1;
  lfo2.connect(lfo2Gain).connect(windGain.gain);
  lfo.start();
  lfo2.start();

  // Birdsong: little chirp bursts at random intervals, panned across the field.
  let stopped = false;
  let timer = 0;
  const chirp = () => {
    if (stopped) return;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    pan.connect(master);
    const notes = 1 + Math.floor(Math.random() * 3);
    const base = 1900 + Math.random() * 2200;
    const start = ctx.currentTime + 0.02;
    for (let n = 0; n < notes; n++) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      const g = ctx.createGain();
      const nt = start + n * (0.09 + Math.random() * 0.09);
      const f = base * (0.9 + Math.random() * 0.3);
      osc.frequency.setValueAtTime(f, nt);
      osc.frequency.exponentialRampToValueAtTime(f * (1.25 + Math.random() * 0.5), nt + 0.05);
      osc.frequency.exponentialRampToValueAtTime(f * 0.85, nt + 0.12);
      g.gain.setValueAtTime(0.0001, nt);
      g.gain.linearRampToValueAtTime(0.09, nt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0006, nt + 0.16); // never ramp to exactly 0
      osc.connect(g).connect(pan);
      osc.start(nt);
      osc.stop(nt + 0.2);
    }
    // release this burst's panner once its notes have finished (avoid piling up
    // idle nodes on master over a long session).
    window.setTimeout(() => {
      try {
        pan.disconnect();
      } catch {
        // context closed; ignore
      }
    }, 1200);
    timer = window.setTimeout(chirp, 2500 + Math.random() * 4500);
  };
  timer = window.setTimeout(chirp, 700);

  return {
    stop: () => {
      stopped = true;
      window.clearTimeout(timer);
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(0, t + 0.6); // fade-out
      window.setTimeout(() => {
        try {
          wind.stop();
          lfo.stop();
          lfo2.stop();
          void ctx.close();
        } catch {
          // context already closing; ignore
        }
      }, 700);
    },
  };
}

export default function IdeaGarden({
  gardens,
  roots = NO_ROOTS,
  onRootSelect,
  onTreeSelect,
}: Props) {
  const router = useRouter();
  const mountRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  // Selection callbacks follow the showLabels/motionOn state+ref pattern: the
  // scene reads the refs, so a new function identity from the parent (which
  // happens on every parent render) never enters the effect deps and never
  // rebuilds the WebGL scene.
  const onRootSelectRef = useRef(onRootSelect);
  const onTreeSelectRef = useRef(onTreeSelect);
  useEffect(() => {
    onRootSelectRef.current = onRootSelect;
    onTreeSelectRef.current = onTreeSelect;
  });
  // The scene is imperative Three.js, so it can't ride the CSS-var ramp. Track
  // the active theme and rebuild the garden (via the effect dep below) when it
  // flips, re-deriving the sky, line-art and control chrome from the palette.
  // Read the real theme at init (safe: themeKey drives the effect, not the JSX,
  // so there's no hydration mismatch) to avoid building the scene dark-first.
  const [themeKey, setThemeKey] = useState(() =>
    typeof document === "undefined"
      ? "dark"
      : document.documentElement.dataset.theme || "dark"
  );
  // Show/hide the channel labels (pills + leader lines). The render loop reads the
  // ref every frame; the state just drives the button + keeps the ref in sync.
  const [showLabels, setShowLabels] = useState(true);
  const showLabelsRef = useRef(true);
  // Forest ambience (off by default; created on first toggle = user gesture).
  const [soundOn, setSoundOn] = useState(false);
  const audioRef = useRef<ForestAudio | null>(null);
  // Camera drift on/off. Same ref-plus-state shape as showLabels: the render
  // loop reads the ref every frame so toggling never rebuilds the scene.
  const [motionOn, setMotionOn] = useState(true);
  const motionRef = useRef(true);
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setThemeKey(document.documentElement.dataset.theme || "dark")
    );
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    showLabelsRef.current = showLabels;
  }, [showLabels]);

  useEffect(() => {
    motionRef.current = motionOn;
  }, [motionOn]);

  // Start/stop the ambience when the toggle flips.
  useEffect(() => {
    if (soundOn && !audioRef.current) audioRef.current = startForestAudio();
    else if (!soundOn && audioRef.current) {
      audioRef.current.stop();
      audioRef.current = null;
    }
  }, [soundOn]);

  // Stop any audio when the garden unmounts (e.g. switching views).
  useEffect(
    () => () => {
      audioRef.current?.stop();
      audioRef.current = null;
    },
    []
  );

  useEffect(() => {
    const mount = mountRef.current;
    const overlay = overlayRef.current;
    if (!mount || !overlay) return;

    // Theme-derived palette for the scene + overlay chrome. Dark = pale line-art
    // on a near-black sky; light themes = dark line-art on the theme background.
    const isDark = (document.documentElement.dataset.theme || "dark") === "dark";
    const skyColor = new THREE.Color(
      getComputedStyle(document.documentElement)
        .getPropertyValue("--background")
        .trim() || (isDark ? "#060606" : "#ffffff")
    );
    const lineColor = new THREE.Color(isDark ? "#e4e4dc" : "#3a3a3a");
    const leafColor = new THREE.Color(isDark ? "#ffffff" : "#2f2f2f");
    const chrome = isDark
      ? {
          bg: "rgba(10,10,10,.72)",
          border: "#222",
          text: "#bdbdbd",
          accent: "#cfcfcf",
          tipBg: "#111",
          tipBorder: "#333",
          tipText: "#fff",
          date: "#9a9a9a",
        }
      : {
          bg: "rgba(255,255,255,.82)",
          border: "#ddd",
          text: "#444",
          accent: "#666",
          tipBg: "#fff",
          tipBorder: "#ddd",
          tipText: "#171717",
          date: "#777",
        };

    // ── device tier ──────────────────────────────────────────────────────────────
    // `lite` covers only the choices that CANNOT change without rebuilding the
    // scene: pixel density, how much grass and wildlife exists, camera feel. Read
    // once, because re-tiering would rebuild the whole WebGL scene, which is worse
    // than a brief mismatch.
    //
    // Everything about LAYOUT (pill type scale, scrubber placement, camera fit)
    // deliberately keys off the live viewport instead, via stylePills /
    // placeScrubber / setOrthoFrustum below. Layout has to follow the window it is
    // in: latching it here left a phone-sized scrubber and phone-sized pills on a
    // desktop window that had been resized after mount.
    const lite =
      window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 640;

    // Live viewport size. Written by the ResizeObserver and read by the label
    // layout + hover projection, so neither has to touch clientWidth/clientHeight
    // mid-frame (that read lands after the previous frame's style writes and
    // forces a synchronous layout every single frame).
    let width = mount.clientWidth || 1;
    let height = mount.clientHeight || 1;

    // ── renderer ───────────────────────────────────────────────────────────────
    // Antialiasing stays ON everywhere, phones included: this scene is thin
    // diagonal line-art, the worst case for stair-stepping, and mobile GPUs
    // resolve MSAA cheaply in tile memory. The pixels come back from a lower
    // density cap below instead, which is the bigger saving anyway.
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, lite ? 1.5 : 2));
    renderer.setSize(width, height);
    renderer.setClearColor(skyColor, 1);
    mount.appendChild(renderer.domElement);

    // ── scene ────────────────────────────────────────────────────────────────────
    // Flat, unlit line-art look - no lights, so nothing casts shading or shadows.
    const scene = new THREE.Scene();

    // ── shared materials + leaf geometries ──────────────────────────────────────
    // Unlit, wireframe leaf material → the GPU draws only each leaf's edges as
    // lines (no fills, no shading). Per-leaf pastel comes from setColorAt
    // (white·instanceColor). Branches are pale flat "lines" too.
    const branchMat = new THREE.LineBasicMaterial({
      color: lineColor,
      transparent: true,
      opacity: 0.95,
    });
    const leafMat = new THREE.MeshBasicMaterial({ color: leafColor, wireframe: true });
    // Three leaf shapes; each plant picks one. Small, fine marks so a crown of
    // many of them reads as delicate stippled foliage (reference line-drawing
    // trees) rather than a cluster of big geometric blobs. Shared, disposed once.
    const leafGeos: THREE.BufferGeometry[] = [
      new THREE.IcosahedronGeometry(0.13, 0), // low-poly wire ball
      new THREE.BoxGeometry(0.15, 0.15, 0.15), // wire cube
      new THREE.OctahedronGeometry(0.14, 0), // wire diamond
    ];

    // ── build all plants first (need radii for size-aware spacing) ───────────────
    const built = gardens.map((channel) => {
      const n = channel.leaves.length;
      // Seed everything shape-related from the topic name, so a topic always
      // renders as the same tree. One of ten species is picked by the name; a
      // name-seeded rng adds small within-species jitter (stable across loads).
      const name = channel.title || channel.slug || channel.id;
      const seed = seedFromId(name);
      const species = pickSpecies(name);
      const vr = mulberry32((seed ^ 0x9e3779b9) >>> 0);
      const variety = speciesParams(species, vr, n);
      const plant = buildPlant({ leafCount: n, seed, ...variety });
      const shape = species.leafShape;
      return { channel, plant, shape, n };
    });

    // ── size-aware ring placement (phyllotaxis with footprint-scaled step) ───────
    const maxFootprint = built.reduce((m, b) => Math.max(m, b.plant.radius), 1);
    // Closer than the crown footprint so canopies interleave → reads as a dense
    // forest rather than isolated specimens.
    const spacing = Math.max(8, maxFootprint * 2.2 + 4);
    const positions = built.map((_, k) => {
      const a = k * GOLDEN;
      const r = spacing * Math.sqrt(k);
      return { x: Math.cos(a) * r, z: Math.sin(a) * r };
    });
    const ringRadius = built.length > 0 ? spacing * Math.sqrt(built.length) : 0;
    const sceneR = ringRadius + maxFootprint + 2;
    const maxH = built.reduce((m, b) => Math.max(m, b.plant.height), 4);

    // ── instantiate plant meshes, grouped per plant ──────────────────────────────
    const leafMeshes: THREE.InstancedMesh[] = [];
    const plantViews: PlantView[] = [];
    // Branch LineSegments double as "the tree" for hover/click (raycast
    // targets), each tagged with its channel id below.
    const branchLines: THREE.LineSegments[] = [];
    // Channel whose label pill is hovered; its incident roots darken.
    let pillHoverChannel: string | null = null;
    const tmpMatrix = new THREE.Matrix4();
    const tmpColor = new THREE.Color();

    built.forEach((b, k) => {
      const { channel, plant, shape, n } = b;
      const pos = positions[k];
      const group = new THREE.Group();
      group.position.set(pos.x, 0, pos.z);

      // Branches → crisp 1px line segments per plant (each segment = start→end pair).
      const linePos = new Float32Array(plant.segments.length * 6);
      plant.segments.forEach((s, i) => {
        const o = i * 6;
        linePos[o] = s.start.x;
        linePos[o + 1] = s.start.y;
        linePos[o + 2] = s.start.z;
        linePos[o + 3] = s.end.x;
        linePos[o + 4] = s.end.y;
        linePos[o + 5] = s.end.z;
      });
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
      const branchSegs = new THREE.LineSegments(lineGeo, branchMat);
      branchSegs.userData.channelId = channel.id;
      branchLines.push(branchSegs);
      group.add(branchSegs);

      // Leaves → one InstancedMesh per plant; one pastel hue, subtle per-leaf jitter.
      const inst = new THREE.InstancedMesh(leafGeos[shape], leafMat, n);
      const lr = mulberry32((seedFromId(channel.id) ^ 0x85ebca6b) >>> 0);
      // Leaf size scales with the crown footprint so foliage reads as mass at any
      // tree size (crowns are much larger than the 0.13u base leaf geometry).
      const leafScale = Math.max(1, plant.radius * 0.16);
      const meta: GardenLeaf[] = new Array(n);
      for (let i = 0; i < n; i++) {
        const lp = plant.leaves[i].position;
        const s = leafScale * (0.7 + lr() * 0.5); // per-leaf size variance
        tmpMatrix.makeScale(s, s, s);
        tmpMatrix.setPosition(lp.x, lp.y, lp.z);
        inst.setMatrixAt(i, tmpMatrix);
        // Brand colour per channel, with a little per-leaf lightness jitter so
        // the crown reads as foliage rather than one flat block of colour.
        tmpColor.set(channel.color).offsetHSL(0, 0, -0.06 + lr() * 0.14);
        inst.setColorAt(i, tmpColor);
        meta[i] = channel.leaves[i];
      }
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.userData.leafMeta = meta;
      group.add(inst);
      leafMeshes.push(inst);
      scene.add(group);

      // Per-channel "balloon": a rounded label that floats above the crown on a
      // short string. Centered on the plant and anchored from its bottom, so it
      // hovers over the tree. Positioned every frame.
      //
      // pointer-events:none is LOAD-BEARING, do not "restore" it. The pills live
      // in the overlay, a SIBLING of the canvas, so anything they capture never
      // reaches OrbitControls: a drag or pinch starting on a label moved nothing
      // at all, and a two-finger one could be taken by the browser as a page
      // zoom. On a phone the pills crowd the middle of the screen, exactly where
      // a thumb lands, so that ate most gestures. They stay inert and are
      // hit-tested in screen space by pillAt() instead, reusing the boxes the
      // label layout already computes for collision.
      //
      // Positioning is transform-only (see updateLabels): left/top are not
      // compositable, so writing them every frame forced layout.
      const pill = document.createElement("div");
      pill.textContent = channel.title;
      // Type scale and box width come from stylePills(), which follows the live
      // viewport rather than the build-time tier.
      pill.style.cssText =
        "position:absolute;left:0;top:0;border-radius:999px;letter-spacing:.02em;" +
        "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" +
        "pointer-events:none;box-shadow:0 1px 4px rgba(0,0,0,.5);will-change:transform";
      pill.style.background = channel.color;
      // Dark swatches (Forest Green, Lavender Purple) need light text, or the
      // label is unreadable on its own pill.
      pill.style.color = inkOn(channel.color);
      overlay.appendChild(pill);

      // The balloon's string, drawn down to the crown each frame.
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("stroke", channel.color);
      line.setAttribute("stroke-width", "1");
      line.setAttribute("stroke-opacity", "0.4");

      const dates = channel.leaves.map((l) => {
        const t = Date.parse(l.createdAt);
        return Number.isNaN(t) ? 0 : t;
      });

      plantViews.push({
        channel,
        group,
        inst,
        n,
        dates,
        height: plant.height,
        pill,
        line,
        sx: 0,
        sy: 0,
        cx: 0,
        cy: 0,
        pw: 0,
        ph: 0,
        lift: 0,
        liftEased: 0,
        drawY: 0,
        labelOn: false,
      });
    });

    // Bigger type and a narrower box on a narrow viewport: readable at arm's
    // length, and a narrow box collides with its neighbours far less often. Keyed
    // to the live width, so a rotation or a window resize re-scales the labels.
    const stylePills = () => {
      const narrow = width < 640;
      for (const pv of plantViews) {
        pv.pill.style.font = `600 ${narrow ? 12 : 11}px/1 Inter,system-ui,sans-serif`;
        pv.pill.style.padding = narrow ? "4px 11px" : "3px 10px";
        pv.pill.style.maxWidth = narrow ? "42vw" : "150px";
      }
    };

    // Measure every pill in ONE pass, after they are all in the DOM, so a single
    // layout flush covers the lot instead of one per pill. These boxes drive both
    // the collision pass and the tap hit test, so nothing downstream ever needs
    // to read layout again.
    const measurePills = () => {
      for (const pv of plantViews) {
        pv.pw = pv.pill.offsetWidth;
        pv.ph = pv.pill.offsetHeight;
      }
    };
    stylePills();
    measurePills();
    // Inter arriving after first paint changes every pill's width, which would
    // leave the collision boxes and hit targets permanently stale. Re-measure
    // once when the font is settled; the flag keeps a late resolve off a torn
    // down scene.
    let disposed = false;
    document.fonts?.ready.then(() => {
      if (!disposed) measurePills();
    });

    // Point sprites (root anchors, bees, grass dots) need a texture to be
    // anything but a square, so we paint each mark shape onto a tiny canvas
    // and use it as the points' map.
    const makeMarkTexture = (draw: (ctx: CanvasRenderingContext2D, s: number) => void) => {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 64;
      const ctx = cv.getContext("2d");
      if (ctx) draw(ctx, 64);
      return new THREE.CanvasTexture(cv);
    };
    // Round sprite for the root anchor dots; painted white, tinted to the
    // theme ink via the material colour (near-white on dark, dark on light,
    // so the anchors never vanish into the background).
    const rootDotTex = makeMarkTexture((ctx, s) => {
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, s * 0.3, 0, Math.PI * 2);
      ctx.fill();
    });

    // ── roots: shared-concept connections drawn under the soil ──────────────────
    // Each GardenRoot becomes an organic curve from one trunk base down below
    // y=0 and back up into the other trunk. The orthographic frustum already
    // leaves ~0.65*maxH of visible world below the soil line, so no camera
    // changes are needed. Roots are SCENE-LEVEL SIBLINGS of the tree groups,
    // never children: the timeline scrub scales/hides whole groups, and a root
    // parented to a tree would stretch with it.
    const plantById = new Map<string, PlantView>();
    plantViews.forEach((pv) => plantById.set(pv.channel.id, pv));
    const rootViews: RootView[] = [];
    const rootUp = new THREE.Vector3(0, 1, 0);
    const rootTmpColor = new THREE.Color();
    for (const root of roots) {
      const pvA = plantById.get(root.a);
      const pvB = plantById.get(root.b);
      if (!pvA || !pvB) continue; // endpoint channel not planted (no leaves)
      // Seeded like the trees: the same pair always grows the same root.
      const rng = mulberry32(seedFromId(root.a + ":" + root.b));
      const a = pvA.group.position;
      const b = pvB.group.position;
      const chord = new THREE.Vector3().subVectors(b, a);
      const chordLen = chord.length() || 1;
      // How deep the root dives. The under-soil head-room the frustum shows
      // grows with the SCENE, not the trees (halfH tracks
      // sceneR*sin(20°)+maxH, see setOrthoFrustum), so the depth budget must
      // too: capped at maxH*0.6, wide gardens got roots that read as a flat
      // net instead of a plunge. 0.34 = sin of the camera's 20° elevation.
      const depthBudget = (sceneR * 0.34 + maxH) * 0.45;
      const dip = THREE.MathUtils.clamp(
        chordLen * 0.35,
        Math.min(maxH * 0.4, depthBudget * 0.8),
        depthBudget
      );
      // A consistent one-sided horizontal bow (side picked once per root) so
      // the curve stays legible while the camera auto-rotates, instead of
      // collapsing into a straight line edge-on.
      const side = rng() < 0.5 ? 1 : -1;
      const bowMag = (0.05 + rng() * 0.08) * chordLen * side;
      const perp = new THREE.Vector3().crossVectors(chord, rootUp);
      if (perp.lengthSq() < 1e-6) perp.set(1, 0, 0);
      perp.normalize();
      // Control stations as (t along the chord, fraction of dip) pairs. The
      // shape is deliberately root-like: a near-VERTICAL plunge out of each
      // trunk base (half depth within 6% of horizontal travel), a deep run
      // through the middle, and a steep climb into the other trunk.
      const stations: [number, number][] = [
        [0, 0],
        [0.06, 0.5],
        [0.22, 0.85],
        [0.5, 1],
        [0.78, 0.85],
        [0.94, 0.5],
        [1, 0],
      ];
      const ctrl = stations.map(([t, df]) => {
        const wave = Math.sin(Math.PI * t);
        const wiggle = df === 0 ? 0 : (rng() - 0.5) * 0.9; // organic, seeded
        return new THREE.Vector3(
          a.x + chord.x * t + perp.x * bowMag * wave + wiggle,
          -dip * df * (df === 0 ? 1 : 0.9 + rng() * 0.2),
          a.z + chord.z * t + perp.z * bowMag * wave + wiggle
        );
      });
      const curve = new THREE.CatmullRomCurve3(ctrl);
      const pts = curve.getPoints(48);
      // linewidth is a no-op on WebGL, so "thickness" = parallel strands:
      // 1/2/3 by weight tier. All strands share ONE geometry + LineSegments.
      const strandOffsets =
        root.weight > 0.66 ? [-0.3, 0, 0.3] : root.weight > 0.33 ? [-0.16, 0.16] : [0];
      const posArr: number[] = [];
      const colArr: number[] = [];
      const pushVert = (x: number, y: number, z: number) => {
        posArr.push(x, y, z);
        // Depth cue: a flat colour ramp from ink toward the sky colour as
        // the root dives (no glow, no fog, just lerped vertex colour).
        const fade = THREE.MathUtils.clamp((y / -dip) * 0.35, 0, 0.35);
        rootTmpColor.copy(lineColor).lerp(skyColor, fade);
        colArr.push(rootTmpColor.r, rootTmpColor.g, rootTmpColor.b);
      };
      const last = pts.length - 1;
      for (const off of strandOffsets) {
        for (let i = 0; i < last; i++) {
          for (const idx of [i, i + 1]) {
            const p = pts[idx];
            // Strands pinch together at both ends (sqrt-eased) so the root
            // visibly grows OUT of the trunk instead of arriving as rails.
            const pinch = Math.sqrt(Math.sin(Math.PI * (idx / last)));
            pushVert(p.x + perp.x * off * pinch, p.y, p.z + perp.z * off * pinch);
          }
        }
      }
      // Rootlets: short kinked side-branches sprouting mostly downward off
      // the main root, the same trick the trees use to read as organic.
      const rootletCount = 4 + strandOffsets.length * 2;
      const rootletP = new THREE.Vector3();
      for (let k = 0; k < rootletCount; k++) {
        curve.getPoint(0.08 + rng() * 0.84, rootletP);
        const len = dip * (0.12 + rng() * 0.15);
        const p0 = rootletP.clone();
        const p1 = p0
          .clone()
          .add(
            new THREE.Vector3(rng() - 0.5, -(0.6 + rng() * 0.7), rng() - 0.5)
              .normalize()
              .multiplyScalar(len)
          );
        const p2 = p1
          .clone()
          .add(
            new THREE.Vector3(rng() - 0.5, -(0.4 + rng() * 0.8), rng() - 0.5)
              .normalize()
              .multiplyScalar(len * 0.6)
          );
        pushVert(p0.x, p0.y, p0.z);
        pushVert(p1.x, p1.y, p1.z);
        pushVert(p1.x, p1.y, p1.z);
        pushVert(p2.x, p2.y, p2.z);
      }
      const rootGeo = new THREE.BufferGeometry();
      rootGeo.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(posArr), 3)
      );
      rootGeo.setAttribute(
        "color",
        new THREE.BufferAttribute(new Float32Array(colArr), 3)
      );
      const baseOpacity = 0.2 + root.weight * 0.2;
      // Per-root material instance (NOT shared): each root eases its own
      // opacity toward its hover target. depthWrite off so overlapping
      // transparent lines don't pop as the draw order changes.
      const rootMat = new THREE.LineBasicMaterial({
        transparent: true,
        depthWrite: false,
        vertexColors: true,
        opacity: baseOpacity,
      });
      const line = new THREE.LineSegments(rootGeo, rootMat);
      scene.add(line);
      // The connection's click handle: one small dot at the arc's LOWEST
      // point (the same spot the tooltip anchors to), so each root has an
      // obvious thing to aim for down in the under-soil tangle.
      const mid = curve.getPoint(0.5);
      const anchorGeo = new THREE.BufferGeometry();
      anchorGeo.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array([mid.x, mid.y, mid.z]), 3)
      );
      const anchorMat = new THREE.PointsMaterial({
        map: rootDotTex,
        color: lineColor,
        size: 4,
        sizeAttenuation: false,
        transparent: true,
        depthWrite: false,
        alphaTest: 0.4,
        opacity: Math.min(0.9, baseOpacity * 2),
      });
      const dots = new THREE.Points(anchorGeo, anchorMat);
      scene.add(dots);
      const rv: RootView = {
        root,
        line,
        mat: rootMat,
        dots,
        dotMat: anchorMat,
        pvA,
        pvB,
        baseOpacity,
        opacity: baseOpacity,
        mid,
      };
      line.userData.rootView = rv;
      dots.userData.rootView = rv; // clicking the handle selects the root too
      rootViews.push(rv);
    }

    // ── crystals: faceted line-art gems on slender stalks ───────────────────────
    // Reworked from the old floating sprite cloud into thin OUTLINE gems drawn in
    // the same pale line colour as the branches, each rooted on the ground on a
    // vertical stalk - so they read "in lines" and match the trees' line-art look
    // (little crystal plants standing among the trees) instead of a random haze.
    const crystalSeg: number[] = [];
    const pushSeg = (
      ax: number, ay: number, az: number, bx: number, by: number, bz: number
    ) => crystalSeg.push(ax, ay, az, bx, by, bz);
    const CRYSTALS = Math.min(lite ? 36 : 60, Math.max(20, Math.floor(sceneR * 0.9)));
    for (let i = 0; i < CRYSTALS; i++) {
      const a = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * (sceneR + 6);
      const cx = Math.cos(a) * rad;
      const cz = Math.sin(a) * rad;
      const th = Math.random() * Math.PI; // horizontal facing of the gem's width axis
      const ux = Math.cos(th);
      const uz = Math.sin(th);
      const stalkH = 3 + Math.random() * (5 + maxH * 0.08);
      pushSeg(cx, 0, cz, cx, stalkH, cz); // slender vertical stalk
      const gems = Math.random() < 0.5 ? 1 : 2;
      let baseY = stalkH;
      for (let g = 0; g < gems; g++) {
        const w = 1.3 + Math.random() * 1.4; // half-width (big enough to read at fit-all)
        const hh = w * (1.5 + Math.random() * 0.5); // half-height (tall faceted gem)
        const cy = baseY + hh;
        const rx = cx + ux * w;
        const rz = cz + uz * w; // right vertex
        const lx = cx - ux * w;
        const lz = cz - uz * w; // left vertex
        // rhombus outline + a vertical facet line through it
        pushSeg(cx, cy + hh, cz, rx, cy, rz);
        pushSeg(rx, cy, rz, cx, cy - hh, cz);
        pushSeg(cx, cy - hh, cz, lx, cy, lz);
        pushSeg(lx, cy, lz, cx, cy + hh, cz);
        pushSeg(cx, cy + hh, cz, cx, cy - hh, cz);
        baseY = cy + hh + 0.12;
      }
    }
    const crystalGeo = new THREE.BufferGeometry();
    crystalGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(crystalSeg), 3)
    );
    const crystalMat = new THREE.LineBasicMaterial({
      color: lineColor,
      transparent: true,
      opacity: 0.42,
    });
    scene.add(new THREE.LineSegments(crystalGeo, crystalMat));

    // ── grass: short splayed blades scattered on the ground (flat line-art) ──────
    // One LineSegments for all blades (cheap); muted green, low opacity so it
    // reads as ground cover, not a lawn. Clumped in tufts for an organic look.
    const GRASS_TUFTS = Math.min(lite ? 220 : 500, Math.max(120, Math.floor(sceneR * 4)));
    const BLADES = 3;
    const grassPos = new Float32Array(GRASS_TUFTS * BLADES * 6);
    let gp = 0;
    for (let t = 0; t < GRASS_TUFTS; t++) {
      const a = Math.random() * Math.PI * 2;
      // center-weighted (pow > 0.5) so blades cluster toward the middle
      const rad = Math.pow(Math.random(), 1.5) * (sceneR + 6);
      const cx = Math.cos(a) * rad;
      const cz = Math.sin(a) * rad;
      for (let b = 0; b < BLADES; b++) {
        const bx = cx + (b - 1) * 0.12 + (Math.random() - 0.5) * 0.1;
        const bz = cz + (Math.random() - 0.5) * 0.14;
        const h = 0.35 + Math.random() * 0.45;
        const lean = (Math.random() - 0.5) * 0.28;
        grassPos[gp++] = bx;
        grassPos[gp++] = 0;
        grassPos[gp++] = bz;
        grassPos[gp++] = bx + lean;
        grassPos[gp++] = h;
        grassPos[gp++] = bz + lean * 0.5;
      }
    }
    const grassGeo = new THREE.BufferGeometry();
    grassGeo.setAttribute("position", new THREE.BufferAttribute(grassPos, 3));
    // Grass in the theme ink, like every other line in the scene: white
    // line-art on dark themes, near-black on light ones. No green anywhere.
    const grassMat = new THREE.LineBasicMaterial({
      color: lineColor,
      transparent: true,
      opacity: 0.5,
    });
    scene.add(new THREE.LineSegments(grassGeo, grassMat));

    // ── grass dots: fine ground stipple, densest at the centre and thinning out ──
    // toward the edge, so the grass spreads gradually from the middle of the forest.
    // White sprite, tinted PER DOT below so the meadow can fade with radius.
    const dotTex = makeMarkTexture((ctx, s) => {
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, s * 0.26, 0, Math.PI * 2);
      ctx.fill();
    });
    // The stipple is the scene's one big blended-overdraw cost, so phones get a
    // third of the dots. Their size goes up to compensate, keeping the meadow
    // reading at a similar density rather than visibly thinning out.
    const GRASS_DOTS = Math.min(lite ? 6000 : 20000, Math.max(4000, Math.floor(sceneR * 16)));
    const grassSpread = sceneR * 1.35; // reach past the tree ring
    const dotPos = new Float32Array(GRASS_DOTS * 3);
    const dotCol = new Float32Array(GRASS_DOTS * 3);
    // The stipple uses the same ink; its radial gradient still fades it
    // toward the sky colour with distance.
    const grassInk = lineColor.clone();
    const dotTint = new THREE.Color();
    for (let i = 0; i < GRASS_DOTS; i++) {
      const a = Math.random() * Math.PI * 2;
      // pow > 0.5 biases toward the centre -> density falls off with radius,
      // and the per-dot colour lerps toward the sky the further out it sits:
      // density + colour together read as one gradient from a thick green
      // centre to a dissolving edge.
      const frac = Math.pow(Math.random(), 1.6);
      const rad = frac * grassSpread;
      dotPos[i * 3] = Math.cos(a) * rad;
      dotPos[i * 3 + 1] = Math.random() * 0.22; // hug the ground
      dotPos[i * 3 + 2] = Math.sin(a) * rad;
      dotTint.copy(grassInk).lerp(skyColor, Math.min(0.85, frac * 0.9));
      dotCol[i * 3] = dotTint.r;
      dotCol[i * 3 + 1] = dotTint.g;
      dotCol[i * 3 + 2] = dotTint.b;
    }
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute("position", new THREE.BufferAttribute(dotPos, 3));
    dotGeo.setAttribute("color", new THREE.BufferAttribute(dotCol, 3));
    const dotMat = new THREE.PointsMaterial({
      map: dotTex,
      vertexColors: true,
      size: lite ? 5 : 4,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      alphaTest: 0.4,
    });
    scene.add(new THREE.Points(dotGeo, dotMat));

    // ── birds: line-art gulls that glide along looping paths and flap ────────────
    // Each bird is a little "M" silhouette (two elbowed wings + a beak) drawn in
    // the same pale line colour as the branches. It's oriented along its flight
    // direction (so it flies forward, beak first) and its wings beat up and down
    // every frame - reads clearly as a bird, not a dot. No trails (that was the
    // bee "pollination path" idea); birds just fly around and above the canopy.
    // Each bird costs ~3 curve evaluations per frame plus its share of the
    // rewritten vertex buffer, so phones fly a smaller flock.
    const BIRD_COUNT = Math.min(lite ? 14 : 26, Math.max(lite ? 8 : 12, built.length + 8));
    const birdCurves: THREE.CatmullRomCurve3[] = [];
    const birdSpeed: number[] = [];
    const birdPhase: number[] = [];
    const flapPhase: number[] = [];
    const flapW: number[] = [];
    for (let i = 0; i < BIRD_COUNT; i++) {
      // Flight tiers so the whole space above the forest reads as a living dome:
      // some birds skim the canopy, some cross above the labels, some soar high.
      const t = Math.random();
      let yLo: number;
      let ySpan: number;
      let rLo: number;
      let rSpan: number;
      let soar = false;
      if (t < 0.4) {
        yLo = maxH * 0.5; ySpan = maxH * 0.45; rLo = 0.35; rSpan = 0.65; // canopy level
      } else if (t < 0.72) {
        yLo = maxH * 1.05; ySpan = maxH * 0.65; rLo = 0.4; rSpan = 0.65; // above the labels
      } else {
        yLo = maxH * 1.7; ySpan = maxH * 0.8; rLo = 0.5; rSpan = 0.65; soar = true; // high dome
      }
      const ctrl: THREE.Vector3[] = [];
      const loops = 4 + Math.floor(Math.random() * 3);
      for (let p = 0; p < loops; p++) {
        const a = Math.random() * Math.PI * 2;
        const r = (rLo + Math.random() * rSpan) * sceneR;
        const y = yLo + Math.random() * ySpan;
        ctrl.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
      }
      birdCurves.push(new THREE.CatmullRomCurve3(ctrl, true, "catmullrom", 0.5));
      // high soarers drift a little slower (gliding); low birds a bit livelier
      birdSpeed.push(soar ? 0.004 + Math.random() * 0.004 : 0.006 + Math.random() * 0.008);
      birdPhase.push(Math.random());
      flapPhase.push(Math.random() * Math.PI * 2);
      flapW.push((1.6 + Math.random() * 1.1) * Math.PI * 2); // ~1.6-2.7 wingbeats / sec
    }

    // One LineSegments for all birds: 5 segments each (2 per wing + 1 beak) = 10
    // vertices, rewritten every frame from each bird's position, heading and flap.
    const BIRD_SEGS = 5;
    const birdGeo = new THREE.BufferGeometry();
    const birdPos = new Float32Array(BIRD_COUNT * BIRD_SEGS * 2 * 3);
    birdGeo.setAttribute("position", new THREE.BufferAttribute(birdPos, 3));
    const birdMat = new THREE.LineBasicMaterial({
      color: lineColor,
      transparent: true,
      opacity: 0.9,
    });
    scene.add(new THREE.LineSegments(birdGeo, birdMat));

    const birdSpan = Math.max(5, Math.min(13, maxH * 0.13)); // wingspan (world units)
    const bPos = new THREE.Vector3();
    const bFwd = new THREE.Vector3();
    const bSide = new THREE.Vector3();
    const bUp = new THREE.Vector3();
    const WORLD_UP = new THREE.Vector3(0, 1, 0);
    const updateBirds = (time: number) => {
      let o = 0;
      const put = (x: number, y: number, z: number) => {
        birdPos[o++] = x;
        birdPos[o++] = y;
        birdPos[o++] = z;
      };
      for (let i = 0; i < BIRD_COUNT; i++) {
        let u = birdPhase[i] + time * birdSpeed[i];
        u -= Math.floor(u); // wrap into [0,1)
        birdCurves[i].getPoint(u, bPos);
        birdCurves[i].getTangent(u, bFwd).normalize(); // heading
        bSide.crossVectors(bFwd, WORLD_UP);
        if (bSide.lengthSq() < 1e-6) bSide.set(1, 0, 0);
        bSide.normalize();
        bUp.crossVectors(bSide, bFwd).normalize();

        const flap = Math.sin(time * flapW[i] + flapPhase[i]); // -1..1 wingbeat
        // Permanent gull dihedral (elbow up, tip lower = a clear "M") PLUS the
        // flap on top, so it reads as a bird through the whole wingbeat, not a
        // flat dash at mid-stroke. Tips travel most.
        const midY = birdSpan * 0.18 + flap * birdSpan * 0.22;
        const tipY = birdSpan * 0.04 + flap * birdSpan * 0.5;
        const cx = bPos.x;
        const cy = bPos.y;
        const cz = bPos.z;
        // beak: a short segment forward along the flight direction
        put(cx, cy, cz);
        put(cx + bFwd.x * birdSpan * 0.5, cy + bFwd.y * birdSpan * 0.5, cz + bFwd.z * birdSpan * 0.5);
        // each wing: centre -> elbow (mid) -> tip, spread out to the sides
        for (const s of [-1, 1]) {
          const mx = cx + bSide.x * s * birdSpan * 0.5 + bUp.x * midY;
          const my = cy + bSide.y * s * birdSpan * 0.5 + bUp.y * midY;
          const mz = cz + bSide.z * s * birdSpan * 0.5 + bUp.z * midY;
          const tx = cx + bSide.x * s * birdSpan + bUp.x * tipY;
          const ty = cy + bSide.y * s * birdSpan + bUp.y * tipY;
          const tz = cz + bSide.z * s * birdSpan + bUp.z * tipY;
          put(cx, cy, cz);
          put(mx, my, mz);
          put(mx, my, mz);
          put(tx, ty, tz);
        }
      }
      birdGeo.attributes.position.needsUpdate = true;
    };

    // ── orthographic camera (low-angle field view) + controls ───────────────────
    const elevRad = THREE.MathUtils.degToRad(20);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 8000);
    // Portrait fit. On a phone (aspect ~0.46) the needFromH term below is ~2x
    // needV, so fitting the whole tree ring horizontally pulled the camera back
    // ~3.4x further than the garden needed vertically: trees became specks in a
    // thin band, which is also what piled the labels on top of each other.
    //
    // Small viewports instead frame on the TREES: the view is a fixed number of
    // tree heights tall, so a tree is a predictable share of the screen whatever
    // the garden's size. Anchoring to sceneR does not work here, because sceneR
    // grows with sqrt(channel count) and would shrink the trees again as the
    // archive grows. Capped by fitAll so a small garden still fits whole, and
    // minZoom lets anyone pinch out to the full ring, so nothing is unreachable.
    //
    // Applies to any narrow OR short viewport, not just portrait: a phone held
    // sideways is 375px tall, where fitting the whole ring left the trees as
    // specks under a solid mat of labels.
    //
    // Divided by sqrt(aspect) because visible world area goes as halfH²·aspect: a
    // wide short viewport would otherwise show several times as many trees (and
    // therefore labels) as a tall narrow one at the same tree size. Dividing holds
    // the number of trees on screen roughly constant however the phone is held,
    // which is what keeps the labels resolvable in both orientations.
    const SMALL_VIEW_TREE_FIT = 2;
    const SHORT_VIEW = 520;
    // How far a pinch may zoom OUT, derived rather than fixed: the portrait crop
    // has to stay escapable, so the floor is whatever reaches the fit-everything
    // framing. A fixed 0.5 would have left the outer ring permanently unreachable.
    let minZoomFit = 0.5;
    function setOrthoFrustum(w: number, h: number) {
      const aspect = w / h;
      const needV = sceneR * Math.sin(elevRad) + maxH; // vertical world extent
      const needFromH = sceneR / aspect; // horizontal needs halfW ≥ sceneR
      const fitAll = Math.max(needV, needFromH);
      // Roomy landscape viewports (desktop) keep the exact fit-everything look.
      const small = aspect < 1 || h < SHORT_VIEW;
      const treeFit = (maxH * SMALL_VIEW_TREE_FIT) / Math.sqrt(aspect);
      const halfH = (small ? Math.min(fitAll, treeFit) : fitAll) * 1.18 + 1;
      minZoomFit = Math.min(0.5, halfH / (fitAll * 1.18 + 1));
      camera.top = halfH;
      camera.bottom = -halfH;
      camera.right = halfH * aspect;
      camera.left = -halfH * aspect;
      camera.updateProjectionMatrix();
    }
    setOrthoFrustum(width, height);

    const camDist = sceneR * 2 + 60; // ortho: distance only affects clipping
    const azimuth = 0.6;
    const targetY = maxH * 0.35;
    camera.position.set(
      Math.sin(azimuth) * Math.cos(elevRad) * camDist,
      Math.sin(elevRad) * camDist + targetY,
      Math.cos(azimuth) * Math.cos(elevRad) * camDist
    );

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    // Desktop keeps the floaty glide. On touch that same 0.04 (a ~0.4s time
    // constant, floatier even than OrbitControls' own 0.05 default) reads as lag:
    // the camera keeps sliding after your finger has stopped. Firmer damping lets
    // it track the finger.
    controls.dampingFactor = lite ? 0.14 : 0.04;
    controls.maxPolarAngle = Math.PI / 2.1; // stay above the ground
    // Unbounded by default, which let a pinch strand you in deep space or inside
    // a single crown with no way to read where you were. The floor is derived so
    // that pinching out always reaches the whole ring (see setOrthoFrustum).
    controls.minZoom = minZoomFit;
    controls.maxZoom = 6;
    // Pinch toward the fingers rather than the screen centre. Touch only: it
    // shifts controls.target off centre, which would make the desktop idle drift
    // orbit an arbitrary point.
    controls.zoomToCursor = lite;
    controls.target.set(0, targetY, 0);
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.18; // very gentle drift
    // Drift on/off has three inputs: the visitor's explicit Pause/Play toggle
    // (motionRef, also flipped by clicking empty space on desktop), a transient
    // pause while dragging, and on touch a few seconds of hold after a gesture so
    // a view you positioned deliberately does not immediately slide away. All are
    // applied per-frame in the animation loop, so they can never disagree about
    // the final state.
    let dragging = false;
    const DRIFT_HOLD = 4; // seconds of stillness after a touch gesture
    let driftHoldUntil = 0; // in the frame Timer's elapsed-seconds clock
    let frameTime = 0; // last frame's elapsed time, so handlers can read the clock
    const onControlsStart = () => {
      dragging = true;
    };
    const onControlsEnd = () => {
      dragging = false;
    };
    controls.addEventListener("start", onControlsStart);
    controls.addEventListener("end", onControlsEnd);
    controls.update();

    // ── hover tooltip (single, reused) ───────────────────────────────────────────
    const hover = document.createElement("div");
    hover.style.cssText =
      `position:absolute;transform:translate(-50%,calc(-100% - 12px));background:${chrome.tipBg};` +
      `border:1px solid ${chrome.tipBorder};color:${chrome.tipText};padding:6px 10px;border-radius:8px;max-width:280px;` +
      "white-space:nowrap;pointer-events:none;display:none;font:12px/1.35 Inter,system-ui,sans-serif";
    const hoverTitle = document.createElement("div");
    const hoverDate = document.createElement("div");
    hoverDate.style.cssText = `color:${chrome.date};margin-top:2px;font-size:11px`;
    hover.appendChild(hoverTitle);
    hover.appendChild(hoverDate);
    overlay.appendChild(hover);

    // ── leader-line SVG layer ─────────────────────────────────────────────────────
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:visible";
    plantViews.forEach((pv) => svg.appendChild(pv.line));
    overlay.appendChild(svg);

    // ── timeline scrubber ─────────────────────────────────────────────────────────
    let minMs = Infinity;
    let maxMs = -Infinity;
    for (const pv of plantViews)
      for (const d of pv.dates) {
        if (d < minMs) minMs = d;
        if (d > maxMs) maxMs = d;
      }
    if (!Number.isFinite(minMs)) {
      minMs = 0;
      maxMs = 1;
    }
    if (minMs === maxMs) maxMs = minMs + 1;
    const fmtDate = (ms: number) =>
      new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

    let scrubMs = maxMs; // start fully grown
    function applyScrub() {
      for (const pv of plantViews) {
        let k = 0;
        while (k < pv.n && pv.dates[k] <= scrubMs) k++;
        pv.inst.count = k;
        if (k === 0) {
          pv.group.visible = false;
        } else {
          pv.group.visible = true;
          pv.group.scale.y = Math.max(0.001, k / pv.n);
        }
      }
    }

    const scrubWrap = document.createElement("div");
    scrubWrap.style.cssText =
      "position:absolute;left:50%;transform:translateX(-50%);display:flex;" +
      `align-items:center;gap:12px;pointer-events:auto;background:${chrome.bg};` +
      `border:1px solid ${chrome.border};border-radius:999px;padding:7px 16px;backdrop-filter:blur(6px)`;
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "1000";
    slider.value = "1000";
    // Width comes from placeScrubber(): at 240px the row (plus the 104px date
    // label, gaps and padding) came to ~390px and overflowed a 375px phone.
    slider.style.cssText = `accent-color:${chrome.accent};cursor:pointer`;
    const dateLabel = document.createElement("div");
    dateLabel.style.cssText =
      `font:12px/1 Inter,system-ui,sans-serif;color:${chrome.text};min-width:104px;text-align:right;letter-spacing:.03em`;
    dateLabel.textContent = fmtDate(scrubMs);
    const onScrub = () => {
      scrubMs = minMs + (Number(slider.value) / 1000) * (maxMs - minMs);
      dateLabel.textContent = fmtDate(scrubMs);
      applyScrub();
    };
    slider.addEventListener("input", onScrub);
    scrubWrap.appendChild(slider);
    scrubWrap.appendChild(dateLabel);
    overlay.appendChild(scrubWrap);
    applyScrub();

    // The bottom-right corner already stacks the add button and two credit pills,
    // ~145px tall and wide enough to bury a centred scrubber on a narrow screen.
    // Keyed to the live viewport, so rotating a phone moves the control rather
    // than leaving it wherever it happened to start.
    const placeScrubber = () => {
      const narrow = width < 640; // phone portrait
      const phoneLandscape = height < SHORT_VIEW && width < 900;
      slider.style.width = narrow || phoneLandscape ? "min(50vw, 200px)" : "240px";
      if (narrow) {
        // Sit above the whole bottom-right pile.
        scrubWrap.style.left = "50%";
        scrubWrap.style.transform = "translateX(-50%)";
        scrubWrap.style.bottom = "150px";
      } else if (phoneLandscape) {
        // Only ~375px tall, so lifting would strand the control mid-screen. There
        // is width to spare instead, so anchor it left, clear of that corner.
        scrubWrap.style.left = "16px";
        scrubWrap.style.transform = "none";
        scrubWrap.style.bottom = "18px";
      } else {
        scrubWrap.style.left = "50%";
        scrubWrap.style.transform = "translateX(-50%)";
        scrubWrap.style.bottom = "18px";
      }
    };
    placeScrubber();

    // ── balloon labels: float each channel name above its own crown ──────────────
    // Three passes per frame, allocating nothing: project every anchor, resolve
    // overlaps, then write the DOM. Splitting them is what lets the collision pass
    // see all the boxes at once, and it keeps every read ahead of every write.
    const projV = new THREE.Vector3();
    // Scratch, all allocated once. labelOrder is re-sorted in place each frame;
    // the placed* arrays hold the boxes already committed this frame.
    const labelOrder: number[] = plantViews.map((_, i) => i);
    const placedX0 = new Float64Array(plantViews.length);
    const placedX1 = new Float64Array(plantViews.length);
    const placedY0 = new Float64Array(plantViews.length);
    const placedY1 = new Float64Array(plantViews.length);
    // A crowded label is never hidden (a nameless tree is worse than a busy sky):
    // it rises up its own leader line until clear, so it just hangs on a longer
    // string. The climb is capped so a label cannot wander absurdly far from its
    // tree, but the cap scales with the viewport: a fixed 90px could not resolve
    // 60-odd labels in the 375px height of a phone held sideways, and left them
    // in a solid mat. The cap only ever binds under real crowding.
    // 5 rather than a hairline: the stack is solved on each label's TARGET
    // position while the pill is drawn at its eased one, so during the drift the
    // drawn boxes trail the solution by a pixel or two. The gap absorbs that lag,
    // which is cheaper and steadier than feeding the eased positions back into the
    // solver (which oscillates).
    const LABEL_GAP = 5;
    // Keep the stack clear of the Hide labels / sound / pause row and the Concepts
    // button, which are React chrome painted above the overlay: a label that
    // climbed into that band just disappeared behind a button.
    const TOP_INSET = 52;

    const updateLabels = (time: number) => {
      if (!showLabelsRef.current) {
        for (const pv of plantViews) {
          pv.pill.style.display = "none";
          pv.line.style.display = "none";
          pv.labelOn = false;
        }
        return;
      }

      // ── pass A: project each balloon anchor and its crown point ──
      for (let i = 0; i < plantViews.length; i++) {
        const pv = plantViews[i];
        pv.labelOn = pv.group.visible;
        if (!pv.labelOn) continue;
        const top = pv.height * pv.group.scale.y;
        const bob = Math.sin(time * 0.55 + i * 1.7) * 0.3; // slow, gentle floating
        projV.set(pv.group.position.x, top + 1.5 + bob, pv.group.position.z);
        projV.project(camera);
        pv.sx = (projV.x * 0.5 + 0.5) * width;
        pv.sy = (1 - (projV.y * 0.5 + 0.5)) * height;
        projV.set(pv.group.position.x, top + 0.2, pv.group.position.z);
        projV.project(camera);
        pv.cx = (projV.x * 0.5 + 0.5) * width;
        pv.cy = (1 - (projV.y * 0.5 + 0.5)) * height;
        pv.lift = 0;
        // A tree panned outside the canvas has no label to show: pinning one to
        // the edge is clutter for something you cannot see. This is NOT the
        // crowding case, where nothing visible ever loses its name; it is just
        // content outside the view, and it matters now that portrait crops.
        if (pv.cx < -8 || pv.cx > width + 8 || pv.cy < -40 || pv.cy > height + 40) {
          pv.labelOn = false;
          continue;
        }
        // Keep the whole label on screen. A pill cut in half by the edge is
        // unreadable, and its leader line still says which tree it belongs to.
        const halfW = pv.pw / 2;
        if (pv.pw > 0 && pv.pw + 8 < width) {
          pv.sx = Math.min(Math.max(pv.sx, halfW + 4), width - halfW - 4);
        }
      }

      // ── pass B: lift crowded labels, nearest tree first ──
      // The camera looks down from 20°, so a tree further away projects HIGHER on
      // screen: the largest sy is the nearest tree. Placing those first leaves the
      // front row's labels sitting on their own crowns and pushes the distant ones
      // up into the sky above the canopy, which is the direction with room.
      labelOrder.sort((a, b) => plantViews[b].sy - plantViews[a].sy);
      const maxLift = Math.max(70, height * 0.4);
      let placed = 0;
      for (const idx of labelOrder) {
        const pv = plantViews[idx];
        if (!pv.labelOn) continue;
        const x0 = pv.sx - pv.pw / 2;
        const x1 = pv.sx + pv.pw / 2;
        let bottom = pv.sy;
        // Rise clear of everything already placed. Re-check after every move,
        // since clearing one box can push into another; bounded by the number of
        // boxes placed, so it always terminates.
        for (let guard = 0; guard <= placed; guard++) {
          let moved = false;
          for (let k = 0; k < placed; k++) {
            if (x1 <= placedX0[k] || x0 >= placedX1[k]) continue; // clear sideways
            if (bottom <= placedY0[k] || bottom - pv.ph >= placedY1[k]) continue;
            bottom = placedY0[k] - LABEL_GAP; // sit just above that one
            moved = true;
          }
          if (!moved) break;
        }
        // Never climb further than the cap from home, and keep the whole box on
        // screen: the overlay clips, so an overhanging label loses half its name.
        // (A downward fallback for labels pinned at the inset was tried and
        // removed: it re-collided after these clamps and read worse than the
        // handful of residual overlaps it was meant to fix.)
        if (bottom < pv.sy - maxLift) bottom = pv.sy - maxLift;
        if (bottom > height - 4) bottom = height - 4;
        if (bottom - pv.ph < TOP_INSET) bottom = pv.ph + TOP_INSET;
        pv.lift = pv.sy - bottom;
        placedX0[placed] = x0;
        placedX1[placed] = x1;
        placedY0[placed] = bottom - pv.ph;
        placedY1[placed] = bottom;
        placed++;
      }

      // ── pass C: write ──
      for (let i = 0; i < plantViews.length; i++) {
        const pv = plantViews[i];
        if (!pv.labelOn) {
          pv.pill.style.display = "none";
          pv.line.style.display = "none";
          continue;
        }
        // Ease the lift (same shape as the root opacity easing below) so labels
        // glide apart as the garden drifts instead of snapping between layouts.
        pv.liftEased += (pv.lift - pv.liftEased) * 0.25;
        if (Math.abs(pv.lift - pv.liftEased) < 0.2) pv.liftEased = pv.lift;
        // Clamp what is actually DRAWN, not just the target: the ease lags, so on
        // the first frames (liftEased still 0) an off-screen target would paint
        // off-screen and get clipped before it settled.
        const py = Math.min(
          Math.max(pv.sy - pv.liftEased, pv.ph + TOP_INSET),
          height - 4
        );
        pv.drawY = py; // pillAt hit-tests exactly this box
        pv.pill.style.display = "block";
        // transform, not left/top: compositable, so this costs no layout.
        pv.pill.style.transform = `translate3d(${pv.sx}px, ${py}px, 0) translate(-50%, -100%)`;
        // The string stretches to wherever the balloon ended up, which is what
        // keeps a lifted label unmistakably tied to its own tree.
        pv.line.style.display = "block";
        pv.line.setAttribute("x1", String(pv.sx));
        pv.line.setAttribute("y1", String(py));
        pv.line.setAttribute("x2", String(pv.cx));
        pv.line.setAttribute("y2", String(pv.cy));
      }
    };

    // Screen-space hit test for the (deliberately inert) pills. Reads the boxes
    // the layout pass just wrote, including the eased lift, so it always tests
    // exactly what is drawn. Reverse build order = reverse paint order, so the
    // pill visually on top wins.
    const pillAt = (px: number, py: number): PlantView | null => {
      if (!showLabelsRef.current) return null;
      for (let i = plantViews.length - 1; i >= 0; i--) {
        const pv = plantViews[i];
        if (!pv.labelOn || pv.pw === 0) continue;
        const bottom = pv.drawY;
        if (
          px >= pv.sx - pv.pw / 2 &&
          px <= pv.sx + pv.pw / 2 &&
          py >= bottom - pv.ph &&
          py <= bottom
        )
          return pv;
      }
      return null;
    };

    // ── interaction (raycast hover + click) ──────────────────────────────────────
    const raycaster = new THREE.Raycaster();
    // World-space slack for hitting 1px lines (roots, branches). Too big
    // steals empty-ground clicks from the motion toggle; too small makes the
    // roots unhittable. Scaled with the scene so big gardens stay clickable.
    raycaster.params.Line = { threshold: Math.max(0.8, sceneR * 0.012) };
    // The root click-handles are Points; give them a slightly fatter grab
    // radius than the lines so the dot is always the easiest thing to hit.
    raycaster.params.Points = { threshold: Math.max(1.2, sceneR * 0.018) };
    const pointer = new THREE.Vector2();
    // Canvas-relative pixels for the same position, for the pill box test.
    let pointerPx = 0;
    let pointerPy = 0;
    let pointerInside = false;
    let hovered: GardenLeaf | null = null;
    let hoveredRoot: RootView | null = null;
    let hoveredTrunk: string | null = null;
    let hoveredPill: PlantView | null = null;
    const worldPos = new THREE.Vector3();

    // Tracked so the cursor is only written when it actually changes.
    let cursorOn = false;
    const setCursor = (on: boolean) => {
      if (cursorOn === on) return;
      cursorOn = on;
      renderer.domElement.style.cursor = on ? "pointer" : "";
    };
    // Underline the hovered label and darken its tree's roots. Was a pair of
    // mouseenter/mouseleave listeners per pill; now one call from the hover pass,
    // which is what let the pills become inert.
    const setPillHover = (pv: PlantView | null) => {
      if (hoveredPill === pv) return;
      if (hoveredPill) hoveredPill.pill.style.textDecoration = "";
      hoveredPill = pv;
      pillHoverChannel = pv ? pv.channel.id : null;
      if (pv) pv.pill.style.textDecoration = "underline";
    };

    const readPointer = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerPx = clientX - rect.left;
      pointerPy = clientY - rect.top;
      pointer.x = (pointerPx / rect.width) * 2 - 1;
      pointer.y = -(pointerPy / rect.height) * 2 + 1;
    };

    function onMove(e: PointerEvent) {
      readPointer(e.clientX, e.clientY);
      // Touch is deliberately excluded from frame-loop hover: there is no cursor
      // to follow, taps run their own synchronous test in onClick, and leaving it
      // on meant every pan and pinch frame also ran a full-scene raycast.
      pointerInside = e.pointerType !== "touch";
    }
    function onLeave() {
      pointerInside = false;
    }
    function onUp(e: PointerEvent) {
      if (e.pointerType !== "touch") return; // mouse keeps hovering after a drag
      pointerInside = false;
      clearHover();
      // Hold the idle drift briefly so a view you just positioned by hand does
      // not immediately slide out from under you.
      driftHoldUntil = frameTime + DRIFT_HOLD;
    }
    function onCancel() {
      // An interrupted gesture (iOS system swipe, an incoming call banner) never
      // fires pointerup, which would otherwise leave hover latched on and the
      // drift wedged off for good.
      pointerInside = false;
      dragging = false;
      clearHover();
      driftHoldUntil = frameTime + DRIFT_HOLD;
    }
    let downX = 0;
    let downY = 0;
    function onDown(e: PointerEvent) {
      downX = e.clientX;
      downY = e.clientY;
    }
    function onClick(e: MouseEvent) {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return; // was a drag
      // Touch taps never fire pointermove, so the frame-loop hover state can
      // be stale or empty here: redo one synchronous raycast at the click
      // point before deciding what was clicked (fixes mobile taps).
      readPointer(e.clientX, e.clientY);
      // Labels are inert DOM, so their taps resolve here. They are painted over
      // the scene, so they win over anything the raycast would find behind them.
      const pillHit = pillAt(pointerPx, pointerPy);
      if (pillHit) {
        router.push(`/channel/${pillHit.channel.slug}`);
        return;
      }
      computeHover();
      if (hovered) {
        router.push(`/block/${hovered.id}`);
        return;
      }
      if (hoveredRoot) {
        onRootSelectRef.current?.(hoveredRoot.root);
        return;
      }
      if (hoveredTrunk) {
        onTreeSelectRef.current?.(hoveredTrunk);
        return;
      }
      // Empty space toggles the drift, on desktop only: on a phone the sky is
      // most of the screen and most taps that miss are simply misses, so this
      // fired constantly by accident. The Pause button remains.
      if (!lite) setMotionOn((v) => !v);
    }
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerleave", onLeave);
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("pointercancel", onCancel);
    renderer.domElement.addEventListener("click", onClick);

    function clearHover() {
      setPillHover(null);
      if (hovered || hoveredRoot || hoveredTrunk) {
        hovered = null;
        hoveredRoot = null;
        hoveredTrunk = null;
        hover.style.display = "none";
      }
      setCursor(false);
    }
    // One hover pass, priority pill > leaf > root > trunk. Runs every frame while
    // a non-touch pointer is inside and the camera is still, and once
    // synchronously from onClick.
    const computeHover = () => {
      // Labels first: they are painted over the scene, so a point inside a pill
      // belongs to the pill, not to whatever sits behind it. Also by far the
      // cheapest test, and hitting it skips the raycast entirely.
      const pillHit = pillAt(pointerPx, pointerPy);
      if (pillHit) {
        setPillHover(pillHit);
        hovered = null;
        hoveredRoot = null;
        hoveredTrunk = null;
        hover.style.display = "none";
        setCursor(true);
        return;
      }
      setPillHover(null);
      raycaster.setFromCamera(pointer, camera);
      // Leaves first: the most specific target.
      const hits = raycaster.intersectObjects(leafMeshes, false);
      const hit = hits.find((lh) => lh.instanceId !== undefined);
      if (hit && hit.instanceId !== undefined) {
        hoveredRoot = null;
        hoveredTrunk = null;
        const meta = (hit.object.userData.leafMeta as GardenLeaf[])[hit.instanceId];
        hovered = meta;
        hoverTitle.textContent = meta.title || "Untitled";
        const t = Date.parse(meta.createdAt);
        hoverDate.textContent = Number.isNaN(t) ? "" : new Date(t).toLocaleDateString();
        const inst = hit.object as THREE.InstancedMesh;
        inst.getMatrixAt(hit.instanceId, tmpMatrix);
        worldPos.setFromMatrixPosition(tmpMatrix);
        inst.localToWorld(worldPos);
        worldPos.project(camera);
        hover.style.left = `${(worldPos.x * 0.5 + 0.5) * width}px`;
        hover.style.top = `${(1 - (worldPos.y * 0.5 + 0.5)) * height}px`;
        hover.style.display = "block";
        setCursor(true);
        return;
      }
      hovered = null;
      // Roots next: both the curves and their mid-point click handles. The
      // raycaster does not skip invisible objects on its own, so filter out
      // roots hidden by the scrubber before intersecting.
      const rootTargets: THREE.Object3D[] = [];
      for (const rv of rootViews) {
        if (!rv.line.visible) continue;
        rootTargets.push(rv.dots, rv.line);
      }
      const rHit = raycaster.intersectObjects(rootTargets, false)[0];
      if (rHit) {
        const rv = rHit.object.userData.rootView as RootView;
        hoveredRoot = rv;
        hoveredTrunk = null;
        hoverTitle.textContent = `${rv.pvA.channel.title} and ${rv.pvB.channel.title}`;
        hoverDate.textContent = `${rv.root.sharedCount} shared concept${
          rv.root.sharedCount === 1 ? "" : "s"
        }`;
        // Tooltip anchors at the root's deepest dip, its most visible point.
        worldPos.copy(rv.mid).project(camera);
        hover.style.left = `${(worldPos.x * 0.5 + 0.5) * width}px`;
        hover.style.top = `${(1 - (worldPos.y * 0.5 + 0.5)) * height}px`;
        hover.style.display = "block";
        setCursor(true);
        return;
      }
      hoveredRoot = null;
      // Trunks/branches last: hovering any branch counts as the whole tree.
      // No tooltip (the balloon already names the tree); cursor + darkened
      // incident roots carry the affordance. Skip scrubbed-out trees.
      const tHit = raycaster
        .intersectObjects(branchLines, false)
        .find((bh) => bh.object.parent?.visible);
      if (tHit) {
        hoveredTrunk = tHit.object.userData.channelId as string;
        hover.style.display = "none";
        setCursor(true);
        return;
      }
      clearHover();
    };
    const updateHover = () => {
      if (!pointerInside) {
        clearHover();
        return;
      }
      computeHover();
    };

    // Roots track the scrubber + hover every frame: hidden when either
    // endpoint tree is scrubbed out, faded by the younger tree's growth, and
    // eased toward the hover target (never snapped) so the darkening breathes.
    const updateRoots = () => {
      const activeChannel = hoveredTrunk ?? pillHoverChannel;
      for (const rv of rootViews) {
        const vis = rv.pvA.group.visible && rv.pvB.group.visible;
        rv.line.visible = vis;
        rv.dots.visible = vis;
        if (!vis) continue;
        const growth = Math.min(rv.pvA.group.scale.y, rv.pvB.group.scale.y);
        let target = rv.baseOpacity;
        if (hoveredRoot === rv) target = 0.85;
        else if (
          activeChannel &&
          (rv.root.a === activeChannel || rv.root.b === activeChannel)
        )
          target = 0.55;
        rv.opacity += (target * growth - rv.opacity) * 0.18;
        rv.mat.opacity = rv.opacity;
        // Anchors ride the same ease but doubled (capped), so they stay a
        // clear step brighter than their line at every hover state.
        rv.dotMat.opacity = Math.min(0.9, rv.opacity * 2);
      }
    };

    // ── resize ───────────────────────────────────────────────────────────────────
    // Coalesced into one frame: mobile browser chrome and orientation changes fire
    // this in bursts, and reallocating the drawing buffer per callback is both
    // wasteful and visibly jumpy mid-gesture.
    let roRaf = 0;
    const ro = new ResizeObserver(() => {
      if (roRaf) return;
      roRaf = requestAnimationFrame(() => {
        roRaf = 0;
        const w = mount.clientWidth || 1;
        const h = mount.clientHeight || 1;
        if (w === width && h === height) return;
        width = w;
        height = h;
        setOrthoFrustum(w, h);
        controls.minZoom = minZoomFit; // the fit changed, so the floor moves with it
        renderer.setSize(w, h);
        // Label type scale and the scrubber both follow the viewport, and the
        // pills' vw max-width means their boxes change with it too, so re-style
        // before re-measuring.
        stylePills();
        measurePills();
        placeScrubber();
      });
    });
    ro.observe(mount);

    // ── animation loop ─────────────────────────────────────────────────────────────
    // Timer, not the deprecated Clock (which console-warns on every build).
    // update() advances its internal state once per frame; getElapsed() then
    // reads a stable value however often it's called within that frame.
    const timer = new THREE.Timer();
    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      timer.update();
      const time = timer.getElapsed();
      frameTime = time; // so the pointer handlers can read this clock
      controls.autoRotate =
        motionRef.current && !dragging && (!lite || time > driftHoldUntil);
      controls.update();
      updateBirds(time);
      // The raycast is the most expensive thing in the frame and hover is
      // meaningless while the camera is being moved, so drop it for the duration
      // of the gesture. This is what was stealing frames from every pan and pinch.
      if (dragging) clearHover();
      else updateHover();
      updateRoots();
      updateLabels(time);
      renderer.render(scene, camera);
    };
    animate();

    // ── teardown (StrictMode-safe, no leaks) ──────────────────────────────────────
    return () => {
      disposed = true; // stops a late document.fonts.ready re-measure
      cancelAnimationFrame(raf);
      if (roRaf) cancelAnimationFrame(roRaf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("pointercancel", onCancel);
      renderer.domElement.removeEventListener("click", onClick);
      slider.removeEventListener("input", onScrub);
      controls.removeEventListener("start", onControlsStart);
      controls.removeEventListener("end", onControlsEnd);
      controls.dispose();
      timer.dispose(); // releases its page-visibility listener
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose?.();
      });
      leafGeos.forEach((g) => g.dispose());
      branchMat.dispose();
      leafMat.dispose();
      dotTex.dispose(); // CanvasTextures aren't freed by scene.traverse
      rootDotTex.dispose();
      overlay.replaceChildren(); // removes svg, pills, hover + scrubber DOM
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
    // roots is safe as a dep: it is server-serialized page data, referentially
    // stable across client re-renders (unlike the selection callbacks, which
    // change identity every parent render and therefore live in refs above).
  }, [gardens, roots, router, themeKey]);

  const toggleClass =
    "rounded-full border border-neutral-800 bg-neutral-900/70 px-3 py-1 text-xs backdrop-blur transition-colors";
  // Icon-only variant: a circle rather than a pill, so the two ambient toggles
  // read as controls next to the wider text button.
  const iconToggleClass =
    "flex h-[26px] w-[26px] items-center justify-center rounded-full border border-neutral-800 bg-neutral-900/70 backdrop-blur transition-colors";
  return (
    <div ref={mountRef} className="relative h-full w-full">
      {/* overflow-hidden matters now that the portrait fit crops the scene: a
          tree just off the top edge would otherwise trail its leader line up
          across the TopBar (the leader SVG is deliberately overflow:visible). */}
      <div
        ref={overlayRef}
        className="pointer-events-none absolute inset-0 overflow-hidden"
      />
      {/* Garden controls: hide/show labels + forest ambience (top-left). */}
      <div className="absolute left-4 top-4 z-40 flex gap-2">
        <button
          type="button"
          onClick={() => setShowLabels((v) => !v)}
          aria-pressed={showLabels}
          className={`${toggleClass} ${showLabels ? "text-neutral-100" : "text-neutral-500 hover:text-neutral-300"}`}
        >
          {showLabels ? "Hide labels" : "Show labels"}
        </button>
        {/* Icon only, so aria-label carries the meaning for screen readers. */}
        <button
          type="button"
          onClick={() => setSoundOn((v) => !v)}
          aria-pressed={soundOn}
          aria-label={soundOn ? "Turn sound off" : "Turn sound on"}
          title={soundOn ? "Sound on" : "Sound off"}
          className={`${iconToggleClass} ${soundOn ? "text-neutral-100" : "text-neutral-500 hover:text-neutral-300"}`}
        >
          {soundOn ? <IconSoundOn size={14} /> : <IconSoundOff size={14} />}
        </button>
        {/* Stop the drift so the garden holds still while you browse. Clicking
            empty space toggles the same state. */}
        <button
          type="button"
          onClick={() => setMotionOn((v) => !v)}
          aria-pressed={motionOn}
          aria-label={motionOn ? "Stop rotation" : "Start rotation"}
          title={motionOn ? "Stop rotation" : "Start rotation"}
          className={`${iconToggleClass} ${motionOn ? "text-neutral-100" : "text-neutral-500 hover:text-neutral-300"}`}
        >
          {motionOn ? <IconPause size={14} /> : <IconPlay size={14} />}
        </button>
      </div>
      {/* Credit for the garden concept, sitting just above the site's
          "designed & built by Tanja" pill (bottom-right). */}
      <a
        href="https://x.com/poetengineer__"
        target="_blank"
        rel="noopener noreferrer"
        className="absolute bottom-11 right-4 z-40 rounded-full border border-neutral-800 bg-neutral-900/70 px-3 py-1 text-xs text-neutral-400 backdrop-blur transition-colors hover:text-neutral-100"
      >
        Inspired by Poet Engineer
      </a>
    </div>
  );
}
