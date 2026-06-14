"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { buildPlant, seedFromId, type Vec3 } from "@/lib/lsystem";

export type GardenLeaf = { id: string; title: string };
export type GardenChannel = {
  id: string;
  slug: string;
  title: string;
  hue: number;
  leaves: GardenLeaf[];
};

type Props = { gardens: GardenChannel[] };

const GOLDEN = 137.50776405003785 * (Math.PI / 180);

/**
 * Idea Garden — each channel grows into an L-system plant (blocks = leaves,
 * oldest at the base, newest at the tip). Plants are arranged on a ground plane
 * in a phyllotaxis spiral. Hover a leaf for its title; click to open the block.
 *
 * Pure Three.js (no react-force-graph). Flat matte materials — NO bloom/glow.
 * The whole scene is built in one effect and fully torn down on cleanup so it's
 * safe under React StrictMode's dev double-mount.
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

    // ── renderers ────────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(0x060606, 1);
    mount.appendChild(renderer.domElement);

    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(width, height);
    labelRenderer.domElement.style.position = "absolute";
    labelRenderer.domElement.style.inset = "0";
    labelRenderer.domElement.style.pointerEvents = "none";
    overlay.appendChild(labelRenderer.domElement);

    // ── scene, camera, lights ────────────────────────────────────────────────
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 2000);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x141414, 1.0));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
    dirLight.position.set(8, 24, 12);
    scene.add(dirLight);

    // ── ground placement (phyllotaxis spiral) ────────────────────────────────
    const spacing = 6;
    const positions = gardens.map((_, k) => {
      const a = k * GOLDEN;
      const r = spacing * Math.sqrt(k);
      return { x: Math.cos(a) * r, z: Math.sin(a) * r };
    });
    const gardenRadius =
      (gardens.length > 0 ? spacing * Math.sqrt(gardens.length) : 0) + 6;

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(Math.max(gardenRadius + 4, 12), 64),
      new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 1, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    scene.add(ground);

    // ── build plants ─────────────────────────────────────────────────────────
    // Cylinder aligned from point a to b (local space), open-ended for fewer verts.
    const Y_AXIS = new THREE.Vector3(0, 1, 0);
    function cylinderBetween(a: Vec3, b: Vec3, radius: number): THREE.BufferGeometry {
      const dir = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
      const len = dir.length() || 0.0001;
      dir.normalize();
      const geo = new THREE.CylinderGeometry(radius * 0.72, radius, len, 5, 1, true);
      geo.translate(0, len / 2, 0); // base at origin
      const q = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir);
      geo.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q));
      geo.translate(a.x, a.y, a.z);
      return geo;
    }

    // For raycasting: each leaf InstancedMesh carries its per-instance block meta.
    const leafMeshes: THREE.InstancedMesh[] = [];
    const leafGeo = new THREE.IcosahedronGeometry(0.16, 0);
    const tmpMatrix = new THREE.Matrix4();

    gardens.forEach((channel, k) => {
      const n = channel.leaves.length;
      if (n === 0) return;
      const plant = buildPlant({ leafCount: n, seed: seedFromId(channel.id) });
      const pos = positions[k];

      const leafColor = new THREE.Color().setHSL(channel.hue / 360, 0.55, 0.6);
      const branchColor = new THREE.Color().setHSL(channel.hue / 360, 0.28, 0.34);

      // Branches → one merged mesh per plant.
      const segGeos = plant.segments.map((s) =>
        cylinderBetween(s.start, s.end, s.radius)
      );
      const merged = mergeGeometries(segGeos, false);
      segGeos.forEach((g) => g.dispose());
      const branchMesh = new THREE.Mesh(
        merged,
        new THREE.MeshStandardMaterial({ color: branchColor, roughness: 0.9, metalness: 0 })
      );
      branchMesh.position.set(pos.x, 0, pos.z);
      scene.add(branchMesh);

      // Leaves → one InstancedMesh per plant. plant.leaves[i].index === i, and
      // channel.leaves is oldest→newest, so block i lands on leaf i (base→tip).
      const inst = new THREE.InstancedMesh(
        leafGeo,
        new THREE.MeshStandardMaterial({ color: leafColor, roughness: 0.7, metalness: 0 }),
        n
      );
      inst.position.set(pos.x, 0, pos.z);
      const meta: GardenLeaf[] = new Array(n);
      for (let i = 0; i < n; i++) {
        const lp = plant.leaves[i].position;
        tmpMatrix.makeTranslation(lp.x, lp.y, lp.z);
        inst.setMatrixAt(i, tmpMatrix);
        meta[i] = channel.leaves[i];
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.userData.leafMeta = meta;
      scene.add(inst);
      leafMeshes.push(inst);

      // Persistent channel label at the plant top.
      const tag = document.createElement("div");
      tag.textContent = channel.title;
      tag.style.cssText =
        "font-family:Inter,system-ui,sans-serif;font-size:11px;letter-spacing:.02em;white-space:nowrap;opacity:.75;pointer-events:none;text-shadow:0 1px 2px #000";
      tag.style.color = `hsl(${channel.hue},60%,72%)`;
      const tagObj = new CSS2DObject(tag);
      tagObj.position.set(0, plant.height + 0.7, 0);
      branchMesh.add(tagObj);
    });

    // ── hover label (single, reused) ─────────────────────────────────────────
    const hoverDiv = document.createElement("div");
    hoverDiv.style.cssText =
      "background:#111;color:#fff;padding:6px 10px;border-radius:8px;font-size:12px;line-height:1.3;max-width:240px;white-space:nowrap;font-family:Inter,system-ui,sans-serif;pointer-events:none";
    const hoverLabel = new CSS2DObject(hoverDiv);
    hoverLabel.visible = false;
    scene.add(hoverLabel);

    // ── camera framing ───────────────────────────────────────────────────────
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2.05; // stay above the ground
    controls.target.set(0, 3.5, 0);
    camera.position.set(0, Math.max(gardenRadius * 0.7, 10), Math.max(gardenRadius * 1.5, 18));
    controls.update();

    // ── interaction (raycast hover + click) ──────────────────────────────────
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
    function onClick() {
      if (hovered) router.push(`/block/${hovered.id}`);
    }
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerleave", onLeave);
    renderer.domElement.addEventListener("click", onClick);

    function updateHover() {
      if (!pointerInside) {
        if (hovered) {
          hovered = null;
          hoverLabel.visible = false;
          renderer.domElement.style.cursor = "";
        }
        return;
      }
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(leafMeshes, false);
      const hit = hits.find((h) => h.instanceId !== undefined);
      if (hit && hit.instanceId !== undefined) {
        const meta = (hit.object.userData.leafMeta as GardenLeaf[])[hit.instanceId];
        hovered = meta;
        hoverDiv.textContent = meta.title || "Untitled";
        const inst = hit.object as THREE.InstancedMesh;
        inst.getMatrixAt(hit.instanceId, tmpMatrix);
        worldPos.setFromMatrixPosition(tmpMatrix);
        inst.localToWorld(worldPos);
        hoverLabel.position.copy(worldPos);
        hoverLabel.visible = true;
        renderer.domElement.style.cursor = "pointer";
      } else if (hovered) {
        hovered = null;
        hoverLabel.visible = false;
        renderer.domElement.style.cursor = "";
      }
    }

    // ── resize ───────────────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      labelRenderer.setSize(w, h);
    });
    ro.observe(mount);

    // ── animation loop ───────────────────────────────────────────────────────
    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();
      updateHover();
      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
    };
    animate();

    // ── teardown (StrictMode-safe, no leaks) ─────────────────────────────────
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      renderer.domElement.removeEventListener("click", onClick);
      controls.dispose();
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose?.();
      });
      leafGeo.dispose();
      labelRenderer.domElement.remove(); // removes all CSS2D label DOM
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
