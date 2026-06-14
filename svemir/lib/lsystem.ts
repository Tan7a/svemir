/**
 * Idea Garden — deterministic L-system plant generator.
 *
 * Pure + dependency-free (no three import) so it's trivially testable and safe
 * to import anywhere. Turns a leaf count into a branching "plant" with exactly
 * that many leaf terminals. Original implementation (a budget-splitting turtle,
 * not an axiom-rewrite engine).
 *
 * Determinism: all randomness flows from a seeded PRNG, so a given (leafCount,
 * seed) always yields the same plant — a channel's plant is stable across loads.
 */

export type Vec3 = { x: number; y: number; z: number };
export type Segment = { start: Vec3; end: Vec3; depth: number; radius: number };
/** A leaf terminal. `index` is its rank by height (0 = lowest), so callers can
 * map oldest→newest blocks to base→tip. */
export type Leaf = { position: Vec3; index: number };
export type Plant = {
  segments: Segment[];
  leaves: Leaf[];
  height: number;
  radius: number;
};

export type PlantParams = {
  leafCount: number;
  seed: number;
  /** base internode length (world units). Default 1.0. */
  segmentLength?: number;
  /** branch divergence from parent, degrees. Default 34. */
  branchAngleDeg?: number;
  /** trunk base radius. Default 0.16. */
  baseRadius?: number;
  /** radius shrink per branch level. Default 0.7. */
  taper?: number;
};

// ── seeded PRNG ──────────────────────────────────────────────────────────────

/** mulberry32 — small fast deterministic PRNG. Returns a fn giving [0,1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash an id string to a 32-bit seed (same imul-hash family as hueFromId). */
export function seedFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

// ── vector helpers ───────────────────────────────────────────────────────────

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
function norm(a: Vec3): Vec3 {
  const m = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / m, y: a.y / m, z: a.z / m };
}

/** An orthonormal pair perpendicular to `dir` (used to aim child branches). */
function perpBasis(dir: Vec3): [Vec3, Vec3] {
  // Pick a reference axis least parallel to dir to avoid a degenerate cross.
  const ref: Vec3 = Math.abs(dir.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const side = norm(cross(dir, ref));
  const up = norm(cross(dir, side));
  return [side, up];
}

const GOLDEN_ANGLE = 137.50776405003785 * (Math.PI / 180);

// ── plant builder ────────────────────────────────────────────────────────────

export function buildPlant(params: PlantParams): Plant {
  const leafCount = Math.max(1, Math.floor(params.leafCount));
  const segmentLength = params.segmentLength ?? 1.0;
  const branchAngle = (params.branchAngleDeg ?? 34) * (Math.PI / 180);
  const baseRadius = params.baseRadius ?? 0.16;
  const taper = params.taper ?? 0.7;
  const rng = mulberry32(params.seed || 1);

  const maxDepth = Math.min(6, Math.max(1, Math.ceil(Math.log2(leafCount + 1))));

  const segments: Segment[] = [];
  const leafPts: Vec3[] = [];
  let yaw = 0; // accumulates a golden-angle spiral so branches don't stack in a plane

  // Drop `k` leaves clustered around a tip (used when a branch can't split further).
  function sprayLeaves(center: Vec3, dir: Vec3, k: number) {
    if (k <= 1) {
      leafPts.push(center);
      return;
    }
    const [side, up] = perpBasis(dir);
    const r = 0.18;
    for (let i = 0; i < k; i++) {
      const a = (i / k) * Math.PI * 2 + rng() * 0.6;
      const off = add(scale(side, Math.cos(a) * r), scale(up, Math.sin(a) * r));
      leafPts.push(add(center, scale(off, 0.5 + rng() * 0.6)));
    }
  }

  function grow(start: Vec3, dir: Vec3, budget: number, level: number) {
    const len = segmentLength * Math.pow(0.8, level);
    const end = add(start, scale(dir, len));
    segments.push({ start, end, depth: level, radius: baseRadius * Math.pow(taper, level) });

    if (budget <= 1 || level >= maxDepth) {
      sprayLeaves(end, dir, budget);
      return;
    }

    // Split remaining budget across 2 children (occasionally 3 for asymmetry).
    const childCount = rng() < 0.22 ? 3 : 2;
    const base = Math.floor(budget / childCount);
    let rem = budget % childCount;
    const [side, up] = perpBasis(dir);

    for (let c = 0; c < childCount; c++) {
      const childBudget = base + (rem > 0 ? 1 : 0);
      if (rem > 0) rem--;
      if (childBudget <= 0) continue;

      yaw += GOLDEN_ANGLE;
      const jitter = (rng() - 0.5) * 0.3;
      const pitch = branchAngle * (0.85 + rng() * 0.3);
      // Child direction = parent tilted by `pitch` toward a yaw-rotated perp axis.
      const perp = add(scale(side, Math.cos(yaw + jitter)), scale(up, Math.sin(yaw + jitter)));
      const childDir = norm(add(scale(dir, Math.cos(pitch)), scale(perp, Math.sin(pitch))));
      grow(end, childDir, childBudget, level + 1);
    }
  }

  grow({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, leafCount, 0);

  // Rank leaves by height (lowest first) so index 0 = base, last = tip.
  const ordered = leafPts
    .map((position, i) => ({ position, i }))
    .sort((a, b) => a.position.y - b.position.y || a.i - b.i);
  const leaves: Leaf[] = ordered.map((o, rank) => ({ position: o.position, index: rank }));

  // Bounds for ground packing + camera framing.
  let height = 0;
  let radius = 0;
  const consider = (p: Vec3) => {
    if (p.y > height) height = p.y;
    const r = Math.hypot(p.x, p.z);
    if (r > radius) radius = r;
  };
  for (const s of segments) consider(s.end);
  for (const l of leaves) consider(l.position);

  return { segments, leaves, height, radius };
}
