"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildPlant, mulberry32, seedFromId } from "@/lib/lsystem";
import { pickSpecies, speciesParams } from "@/lib/tree-species";

export type GardenLeaf = { id: string; title: string; createdAt: string };
export type GardenChannel = {
  id: string;
  slug: string;
  title: string;
  hue: number;
  leaves: GardenLeaf[];
};

type Props = { gardens: GardenChannel[] };

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
  sx: number; // last projected anchor screen x
  sy: number; // last projected anchor screen y
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

export default function IdeaGarden({ gardens }: Props) {
  const router = useRouter();
  const mountRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
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

    const width = mount.clientWidth || 1;
    const height = mount.clientHeight || 1;

    // ── renderer ───────────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
      group.add(new THREE.LineSegments(lineGeo, branchMat));

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
        tmpColor.setHSL(channel.hue / 360, 0.52, 0.62 + lr() * 0.14);
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
      const pill = document.createElement("div");
      pill.textContent = channel.title;
      pill.style.cssText =
        "position:absolute;transform:translate(-50%,-100%);padding:3px 10px;border-radius:999px;" +
        "font:600 11px/1 Inter,system-ui,sans-serif;letter-spacing:.02em;white-space:nowrap;" +
        "max-width:150px;overflow:hidden;text-overflow:ellipsis;color:#0a0a0a;pointer-events:none;" +
        "box-shadow:0 1px 4px rgba(0,0,0,.5);will-change:left,top";
      pill.style.background = `hsl(${channel.hue},55%,70%)`;
      overlay.appendChild(pill);

      // The balloon's string, drawn down to the crown each frame.
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("stroke", `hsl(${channel.hue},55%,70%)`);
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
      });
    });

    // Point sprites (bees, grass dots) need a texture to be anything but a square,
    // so we paint each mark shape onto a tiny canvas and use it as the points' map.
    const makeMarkTexture = (draw: (ctx: CanvasRenderingContext2D, s: number) => void) => {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 64;
      const ctx = cv.getContext("2d");
      if (ctx) draw(ctx, 64);
      return new THREE.CanvasTexture(cv);
    };
    // ── crystals: faceted line-art gems on slender stalks ───────────────────────
    // Reworked from the old floating sprite cloud into thin OUTLINE gems drawn in
    // the same pale line colour as the branches, each rooted on the ground on a
    // vertical stalk - so they read "in lines" and match the trees' line-art look
    // (little crystal plants standing among the trees) instead of a random haze.
    const crystalSeg: number[] = [];
    const pushSeg = (
      ax: number, ay: number, az: number, bx: number, by: number, bz: number
    ) => crystalSeg.push(ax, ay, az, bx, by, bz);
    const CRYSTALS = Math.min(60, Math.max(20, Math.floor(sceneR * 0.9)));
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
    const GRASS_TUFTS = Math.min(500, Math.max(120, Math.floor(sceneR * 4)));
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
    const grassMat = new THREE.LineBasicMaterial({
      color: 0x8fa76a,
      transparent: true,
      opacity: 0.5,
    });
    scene.add(new THREE.LineSegments(grassGeo, grassMat));

    // ── grass dots: fine ground stipple, densest at the centre and thinning out ──
    // toward the edge, so the grass spreads gradually from the middle of the forest.
    const dotTex = makeMarkTexture((ctx, s) => {
      ctx.fillStyle = "#9bb173";
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, s * 0.26, 0, Math.PI * 2);
      ctx.fill();
    });
    const GRASS_DOTS = Math.min(5000, Math.max(1000, Math.floor(sceneR * 4)));
    const dotPos = new Float32Array(GRASS_DOTS * 3);
    for (let i = 0; i < GRASS_DOTS; i++) {
      const a = Math.random() * Math.PI * 2;
      // pow > 0.5 biases toward the centre -> density falls off with radius
      const rad = Math.pow(Math.random(), 1.7) * (sceneR + 4);
      dotPos[i * 3] = Math.cos(a) * rad;
      dotPos[i * 3 + 1] = Math.random() * 0.22; // hug the ground
      dotPos[i * 3 + 2] = Math.sin(a) * rad;
    }
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute("position", new THREE.BufferAttribute(dotPos, 3));
    const dotMat = new THREE.PointsMaterial({
      map: dotTex,
      color: 0xffffff,
      size: 4,
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
    const BIRD_COUNT = Math.min(26, Math.max(12, built.length + 8));
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
    function setOrthoFrustum(w: number, h: number) {
      const aspect = w / h;
      const needV = sceneR * Math.sin(elevRad) + maxH; // vertical world extent
      const needFromH = sceneR / aspect; // horizontal needs halfW ≥ sceneR
      const halfH = Math.max(needV, needFromH) * 1.18 + 1;
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
    controls.dampingFactor = 0.04; // lower = floatier, smoother glide
    controls.maxPolarAngle = Math.PI / 2.1; // stay above the ground
    controls.target.set(0, targetY, 0);
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.18; // very gentle drift
    // Persistent drift on/off (toggled by a click on empty space). Dragging pauses
    // the drift, then resumes to whatever this flag says.
    let autoRotateOn = true;
    const onControlsStart = () => {
      controls.autoRotate = false;
    };
    const onControlsEnd = () => {
      controls.autoRotate = autoRotateOn;
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
      "position:absolute;left:50%;bottom:18px;transform:translateX(-50%);display:flex;" +
      `align-items:center;gap:12px;pointer-events:auto;background:${chrome.bg};` +
      `border:1px solid ${chrome.border};border-radius:999px;padding:7px 16px;backdrop-filter:blur(6px)`;
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "1000";
    slider.value = "1000";
    slider.style.cssText = `width:240px;accent-color:${chrome.accent};cursor:pointer`;
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

    // ── balloon labels: float each channel name above its own crown ──────────────
    const projV = new THREE.Vector3();
    const updateLabels = (time: number) => {
      if (!showLabelsRef.current) {
        for (const pv of plantViews) {
          pv.pill.style.display = "none";
          pv.line.style.display = "none";
        }
        return;
      }
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      for (let i = 0; i < plantViews.length; i++) {
        const pv = plantViews[i];
        if (!pv.group.visible) {
          pv.pill.style.display = "none";
          pv.line.style.display = "none";
          continue;
        }
        const top = pv.height * pv.group.scale.y;
        const bob = Math.sin(time * 0.55 + i * 1.7) * 0.3; // slow, gentle floating
        // Balloon anchor (floats above the crown).
        projV.set(pv.group.position.x, top + 1.5 + bob, pv.group.position.z);
        projV.project(camera);
        const bx = (projV.x * 0.5 + 0.5) * w;
        const by = (1 - (projV.y * 0.5 + 0.5)) * h;
        pv.pill.style.display = "block";
        pv.pill.style.left = `${bx}px`;
        pv.pill.style.top = `${by}px`;
        // String from the balloon down to the crown top.
        projV.set(pv.group.position.x, top + 0.2, pv.group.position.z);
        projV.project(camera);
        const cx = (projV.x * 0.5 + 0.5) * w;
        const cy = (1 - (projV.y * 0.5 + 0.5)) * h;
        pv.line.style.display = "block";
        pv.line.setAttribute("x1", String(bx));
        pv.line.setAttribute("y1", String(by));
        pv.line.setAttribute("x2", String(cx));
        pv.line.setAttribute("y2", String(cy));
      }
    };

    // ── interaction (raycast hover + click) ──────────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerInside = false;
    let hovered: GardenLeaf | null = null;
    const worldPos = new THREE.Vector3();

    function onMove(e: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      pointerInside = true;
    }
    function onLeave() {
      pointerInside = false;
    }
    let downX = 0;
    let downY = 0;
    function onDown(e: PointerEvent) {
      downX = e.clientX;
      downY = e.clientY;
    }
    function onClick(e: MouseEvent) {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return; // was a drag
      if (hovered) {
        router.push(`/block/${hovered.id}`);
        return;
      }
      autoRotateOn = !autoRotateOn; // click empty space → toggle the drift
      controls.autoRotate = autoRotateOn;
    }
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerleave", onLeave);
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("click", onClick);

    function clearHover() {
      if (hovered) {
        hovered = null;
        hover.style.display = "none";
        renderer.domElement.style.cursor = "";
      }
    }
    const updateHover = () => {
      if (!pointerInside) {
        clearHover();
        return;
      }
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(leafMeshes, false);
      const hit = hits.find((h) => h.instanceId !== undefined);
      if (hit && hit.instanceId !== undefined) {
        const meta = (hit.object.userData.leafMeta as GardenLeaf[])[hit.instanceId];
        hovered = meta;
        hoverTitle.textContent = meta.title || "Untitled";
        const t = Date.parse(meta.createdAt);
        hoverDate.textContent = Number.isNaN(t) ? "" : new Date(t).toLocaleDateString();
        const inst = hit.object as THREE.InstancedMesh;
        inst.getMatrixAt(hit.instanceId, tmpMatrix);
        worldPos.setFromMatrixPosition(tmpMatrix);
        inst.localToWorld(worldPos);
        const w = mount.clientWidth || 1;
        const h = mount.clientHeight || 1;
        worldPos.project(camera);
        hover.style.left = `${(worldPos.x * 0.5 + 0.5) * w}px`;
        hover.style.top = `${(1 - (worldPos.y * 0.5 + 0.5)) * h}px`;
        hover.style.display = "block";
        renderer.domElement.style.cursor = "pointer";
      } else {
        clearHover();
      }
    };

    // ── resize ───────────────────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      setOrthoFrustum(w, h);
      renderer.setSize(w, h);
    });
    ro.observe(mount);

    // ── animation loop ─────────────────────────────────────────────────────────────
    const clock = new THREE.Clock();
    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const time = clock.getElapsedTime();
      controls.update();
      updateBirds(time);
      updateHover();
      updateLabels(time);
      renderer.render(scene, camera);
    };
    animate();

    // ── teardown (StrictMode-safe, no leaks) ──────────────────────────────────────
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("click", onClick);
      slider.removeEventListener("input", onScrub);
      controls.removeEventListener("start", onControlsStart);
      controls.removeEventListener("end", onControlsEnd);
      controls.dispose();
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
      overlay.replaceChildren(); // removes svg, pills, hover + scrubber DOM
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [gardens, router, themeKey]);

  const toggleClass =
    "rounded-full border border-neutral-800 bg-neutral-900/70 px-3 py-1 text-xs backdrop-blur transition-colors";
  return (
    <div ref={mountRef} className="relative h-full w-full">
      <div ref={overlayRef} className="pointer-events-none absolute inset-0" />
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
        <button
          type="button"
          onClick={() => setSoundOn((v) => !v)}
          aria-pressed={soundOn}
          className={`${toggleClass} ${soundOn ? "text-neutral-100" : "text-neutral-500 hover:text-neutral-300"}`}
        >
          {soundOn ? "Sound on" : "Sound off"}
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
