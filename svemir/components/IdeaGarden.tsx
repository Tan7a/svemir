"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildPlant, mulberry32, seedFromId } from "@/lib/lsystem";

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
 */
export default function IdeaGarden({ gardens }: Props) {
  const router = useRouter();
  const mountRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    const overlay = overlayRef.current;
    if (!mount || !overlay) return;

    const width = mount.clientWidth || 1;
    const height = mount.clientHeight || 1;

    // ── renderer ───────────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(0x060606, 1);
    mount.appendChild(renderer.domElement);

    // ── scene ────────────────────────────────────────────────────────────────────
    // Flat, unlit line-art look - no lights, so nothing casts shading or shadows.
    const scene = new THREE.Scene();

    // ── shared materials + leaf geometries ──────────────────────────────────────
    // Unlit, wireframe leaf material → the GPU draws only each leaf's edges as
    // lines (no fills, no shading). Per-leaf pastel comes from setColorAt
    // (white·instanceColor). Branches are pale flat "lines" too.
    const branchMat = new THREE.LineBasicMaterial({
      color: 0xcfcfca,
      transparent: true,
      opacity: 0.85,
    });
    const leafMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true });
    // Three leaf shapes; each plant picks one. Kept low-poly so the wireframe
    // stays crisp. Shared across plants, disposed once.
    const leafGeos: THREE.BufferGeometry[] = [
      new THREE.IcosahedronGeometry(0.22, 0), // low-poly wire ball
      new THREE.BoxGeometry(0.3, 0.3, 0.3), // wire cube
      new THREE.OctahedronGeometry(0.26, 0), // wire diamond
    ];

    // ── build all plants first (need radii for size-aware spacing) ───────────────
    const built = gardens.map((channel) => {
      const n = channel.leaves.length;
      // Per-channel "genome": stable across loads, distinct between channels.
      const vr = mulberry32((seedFromId(channel.id) ^ 0x9e3779b9) >>> 0);
      const variety = {
        segmentLength: 1.0,
        baseRadius: 0.05, // thin branches
        taper: 0.86, // near-uniform thickness
        branchAngleDeg: 26 + vr() * 16, // 26-42°
        lengthDecay: 0.78 + vr() * 0.08,
        apicalBias: vr() * 0.45,
        pitchJitter: 0.25 + vr() * 0.25,
        wobble: vr() * 0.1,
        // tall bare stem; a touch taller for busier channels
        trunkHeight: 2 + Math.floor(vr() * 3) + Math.min(4, Math.floor(n / 12)),
      };
      const plant = buildPlant({ leafCount: n, seed: seedFromId(channel.id), ...variety });
      const shape = Math.floor(vr() * leafGeos.length);
      return { channel, plant, shape, n };
    });

    // ── size-aware ring placement (phyllotaxis with footprint-scaled step) ───────
    const maxFootprint = built.reduce((m, b) => Math.max(m, b.plant.radius), 1);
    const spacing = Math.max(6, maxFootprint * 2.4 + 2);
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
      const meta: GardenLeaf[] = new Array(n);
      for (let i = 0; i < n; i++) {
        const lp = plant.leaves[i].position;
        const s = 0.8 + lr() * 0.45; // per-leaf size variance
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

    // ── dust marks: gray triangles + cream sparkles drifting through the scene ────
    // Point sprites need a texture to be anything but a square, so we paint each
    // mark shape onto a tiny canvas and use it as the points' map.
    const makeMarkTexture = (draw: (ctx: CanvasRenderingContext2D, s: number) => void) => {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 64;
      const ctx = cv.getContext("2d");
      if (ctx) draw(ctx, 64);
      return new THREE.CanvasTexture(cv);
    };
    const triTex = makeMarkTexture((ctx, s) => {
      ctx.fillStyle = "#cfcabb";
      ctx.beginPath();
      ctx.moveTo(s * 0.5, s * 0.18);
      ctx.lineTo(s * 0.84, s * 0.82);
      ctx.lineTo(s * 0.16, s * 0.82);
      ctx.closePath();
      ctx.fill();
    });
    const starTex = makeMarkTexture((ctx, s) => {
      ctx.fillStyle = "#f3edcf";
      const c = s / 2;
      const o = s * 0.46; // point reach
      const w = s * 0.1; // waist
      ctx.beginPath();
      ctx.moveTo(c, c - o);
      ctx.quadraticCurveTo(c + w, c - w, c + o, c);
      ctx.quadraticCurveTo(c + w, c + w, c, c + o);
      ctx.quadraticCurveTo(c - w, c + w, c - o, c);
      ctx.quadraticCurveTo(c - w, c - w, c, c - o);
      ctx.closePath();
      ctx.fill();
    });
    const makeMarks = (count: number, tex: THREE.Texture, size: number, opacity: number) => {
      const arr = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * (sceneR + 8);
        arr[i * 3] = Math.cos(a) * r;
        arr[i * 3 + 1] = Math.random() * (maxH + 6) - 1; // spread at all heights
        arr[i * 3 + 2] = Math.sin(a) * r;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
      const mat = new THREE.PointsMaterial({
        map: tex,
        size,
        sizeAttenuation: false,
        transparent: true,
        opacity,
        depthWrite: false,
        alphaTest: 0.4,
      });
      return new THREE.Points(geo, mat);
    };
    scene.add(makeMarks(300, triTex, 9, 0.5));
    scene.add(makeMarks(120, starTex, 11, 0.7));

    // ── bees: faint dashed flight-paths + a bright dot that travels each path ─────
    // Each bee follows a smooth looping curve, drawn as a dashed line (the "trail"),
    // with a single dot riding along it. Paths cross over the garden = pollination.
    const BEE_COUNT = Math.min(16, Math.max(7, built.length + 4));
    const beeCurves: THREE.CatmullRomCurve3[] = [];
    const beeSpeed: number[] = [];
    const beePhase: number[] = [];
    const pathMat = new THREE.LineDashedMaterial({
      color: 0xbdb89a,
      transparent: true,
      opacity: 0.22,
      dashSize: 0.6,
      gapSize: 0.5,
    });
    for (let i = 0; i < BEE_COUNT; i++) {
      const ctrl: THREE.Vector3[] = [];
      const loops = 4 + Math.floor(Math.random() * 3);
      for (let p = 0; p < loops; p++) {
        const a = Math.random() * Math.PI * 2;
        const r = (0.25 + Math.random() * 0.9) * sceneR;
        const y = 0.6 + Math.random() * Math.max(2, maxH * 0.7);
        ctrl.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
      }
      const curve = new THREE.CatmullRomCurve3(ctrl, true, "catmullrom", 0.5);
      beeCurves.push(curve);
      beeSpeed.push(0.004 + Math.random() * 0.007);
      beePhase.push(Math.random());
      const path = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(curve.getPoints(90)),
        pathMat
      );
      path.computeLineDistances(); // required for dashes to show
      scene.add(path);
    }
    const beeGeo = new THREE.BufferGeometry();
    const beePos = new Float32Array(BEE_COUNT * 3);
    beeGeo.setAttribute("position", new THREE.BufferAttribute(beePos, 3));
    const beeMat = new THREE.PointsMaterial({
      color: 0xfdf6d0,
      size: 3.4,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    scene.add(new THREE.Points(beeGeo, beeMat));
    const beeTmp = new THREE.Vector3();
    const updateBees = (time: number) => {
      for (let i = 0; i < BEE_COUNT; i++) {
        let u = beePhase[i] + time * beeSpeed[i];
        u -= Math.floor(u); // wrap into [0,1)
        beeCurves[i].getPoint(u, beeTmp);
        beePos[i * 3] = beeTmp.x;
        beePos[i * 3 + 1] = beeTmp.y;
        beePos[i * 3 + 2] = beeTmp.z;
      }
      beeGeo.attributes.position.needsUpdate = true;
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
      "position:absolute;transform:translate(-50%,calc(-100% - 12px));background:#111;" +
      "border:1px solid #333;color:#fff;padding:6px 10px;border-radius:8px;max-width:280px;" +
      "white-space:nowrap;pointer-events:none;display:none;font:12px/1.35 Inter,system-ui,sans-serif";
    const hoverTitle = document.createElement("div");
    const hoverDate = document.createElement("div");
    hoverDate.style.cssText = "color:#9a9a9a;margin-top:2px;font-size:11px";
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
      "align-items:center;gap:12px;pointer-events:auto;background:rgba(10,10,10,.72);" +
      "border:1px solid #222;border-radius:999px;padding:7px 16px;backdrop-filter:blur(6px)";
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "1000";
    slider.value = "1000";
    slider.style.cssText = "width:240px;accent-color:#cfcfcf;cursor:pointer";
    const dateLabel = document.createElement("div");
    dateLabel.style.cssText =
      "font:12px/1 Inter,system-ui,sans-serif;color:#bdbdbd;min-width:104px;text-align:right;letter-spacing:.03em";
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
      updateBees(time);
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
      pathMat.dispose();
      triTex.dispose(); // CanvasTextures aren't freed by scene.traverse
      starTex.dispose();
      overlay.replaceChildren(); // removes svg, pills, hover + scrubber DOM
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [gardens, router]);

  return (
    <div ref={mountRef} className="relative h-full w-full">
      <div ref={overlayRef} className="pointer-events-none absolute inset-0" />
    </div>
  );
}
