/**
 * Idea Garden - deterministic recursive tree generator.
 *
 * Pure + dependency-free (no three import) so it's trivially testable and safe
 * to import anywhere. Turns a leaf count into a branching "plant" with exactly
 * that many leaf terminals.
 *
 * Algorithm: recursive self-similar branching (trunk -> branches -> sub-branches
 * with length/width taper and apical dominance), clamped to a species-shaped
 * crown envelope. Recursion reads as a real tree at any complexity - a topic
 * with 4 notes and one with 400 both get a full, believable skeleton, because
 * the skeleton is DECOUPLED from the note count. The `leafCount` leaves are then
 * distributed across the whole crown (not clumped at the tips). The envelope
 * clamp gives each species a distinct silhouette (columnar, conical, weeping...).
 *
 * Why not space colonization: it only looks natural with thousands of attraction
 * points; with a handful of notes it produces spindly, mis-shapen branches.
 *
 * Determinism: all randomness flows from a seeded PRNG, so a given (leafCount,
 * seed, species params) always yields the same plant - a channel's plant is
 * stable across loads.
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

/** Crown envelope silhouettes. Each maps to a width-vs-height profile so a
 * species reads as a recognizable shape. Derived from the reference DXF trees. */
export type CrownShape =
  | "ellipsoid" // rounded, widest in the middle
  | "oval" // egg, slightly top-weighted
  | "cone" // pyramidal, widest at the base (fir)
  | "spire" // narrow sharp cone (cypress/spruce)
  | "umbrella" // wide flat-topped crown on an open stem
  | "columnar" // tall narrow, full for most of its height (poplar)
  | "mound" // broad dome, widest low
  | "spreading" // broad crown widest in the upper third
  | "weeping" // rounded envelope, foliage droops down (willow)
  | "irregular"; // rounded but asymmetric

export type PlantParams = {
  leafCount: number;
  seed: number;
  /** base internode / branch growth step (world units). Default 1.0. Also the
   * fallback for `growStep` when that is not given. */
  segmentLength?: number;
  /** branch divergence from parent, degrees. Legacy L-system field, unused by
   * the space-colonization grower; kept for backward compatibility. */
  branchAngleDeg?: number;
  /** trunk base radius (cosmetic; branches render as 1px lines). Default 0.16. */
  baseRadius?: number;
  /** radius shrink per branch depth (cosmetic). Default 0.7. */
  taper?: number;
  /** legacy: bare internodes of trunk before the crown, in `segmentLength`
   * units. Superseded by `trunkLength` (world units) when that is given. */
  trunkHeight?: number;
  /** legacy L-system fields, unused by the space-colonization grower; kept for
   * backward compatibility so old call sites still type-check. */
  lengthDecay?: number;
  apicalBias?: number;
  pitchJitter?: number;
  spread?: number;
  /** small per-segment direction perturbation so stems curve. Default 0. */
  wobble?: number;
  /** richness of the branch skeleton / foliage relative to leaf count (alias of
   * `densityFactor` when that is not given). >1 scatters more attractors than
   * there are leaves, so the crown stays full even for channels with few blocks.
   * Default 1. */
  crownDensity?: number;

  // ── space-colonization / species fields ────────────────────────────────────
  /** crown envelope silhouette. Default "ellipsoid". */
  crownShape?: CrownShape;
  /** crown radius at its widest point, world units. Default `crownHeight*0.4`. */
  crownWidth?: number;
  /** vertical extent of the crown, world units. Default `segmentLength*10`. */
  crownHeight?: number;
  /** bare trunk height in world units (up to the crown base). Default derived
   * from legacy `trunkHeight*segmentLength`, else 0. */
  trunkLength?: number;
  /** attractors scattered per leaf (crown fullness / branch richness). Falls
   * back to `crownDensity`. Default 1.4. */
  densityFactor?: number;
  /** attractor influence radius (how far an attractor can pull a node). Default
   * `max(growStep*6, crownWidth*0.75)`. */
  influenceRadius?: number;
  /** attractor kill radius (an attractor is consumed, and drops a leaf, when a
   * node comes within this distance). Default `growStep*2`. */
  killRadius?: number;
  /** branch growth increment per colonization step. Default `crownHeight/14`. */
  growStep?: number;
  /** 0-1: how strongly foliage droops downward (weeping species). Default 0. */
  leafDroop?: number;
  /** 0-1: crown asymmetry / lean. Default 0. */
  irregularity?: number;
};

// ── seeded PRNG ──────────────────────────────────────────────────────────────

/** mulberry32 - small fast deterministic PRNG. Returns a fn giving [0,1). */
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

/** Nudge `dir` by a small random rotation (organic, non-ruler-straight stems). */
function wobbleDir(dir: Vec3, amount: number, rng: () => number): Vec3 {
  if (amount <= 0) return dir;
  const [side, up] = perpBasis(dir);
  const a = rng() * Math.PI * 2;
  const m = rng() * amount;
  const off = add(scale(side, Math.cos(a) * m), scale(up, Math.sin(a) * m));
  return norm(add(dir, off));
}

const GOLDEN_ANGLE = 137.50776405003785 * (Math.PI / 180);

// ── plant builder ────────────────────────────────────────────────────────────

export function buildPlant(params: PlantParams): Plant {
  const leafCount = Math.max(1, Math.floor(params.leafCount));
  const rng = mulberry32(params.seed || 1);

  const baseRadius = params.baseRadius ?? 0.16;
  const taper = params.taper ?? 0.7;
  const wobble = params.wobble ?? 0;

  // Crown envelope + trunk, in world units.
  const shape: CrownShape = params.crownShape ?? "ellipsoid";
  const crownHeight = Math.max(1, params.crownHeight ?? 10);
  const crownWidth = Math.max(0.5, params.crownWidth ?? crownHeight * 0.4); // radius at widest
  const trunkLength = Math.max(
    0,
    params.trunkLength ?? (params.trunkHeight ?? 0) * (params.segmentLength ?? 1)
  );
  const leafDroop = Math.max(0, Math.min(1, params.leafDroop ?? 0));
  const irregularity = Math.max(0, Math.min(1, params.irregularity ?? 0));

  // Recursion / structure params.
  const branchAngle = (params.branchAngleDeg ?? 32) * (Math.PI / 180);
  const apicalBias = Math.max(0, Math.min(1, params.apicalBias ?? 0.4)); // leader dominance
  const lengthDecay = params.lengthDecay ?? 0.82;
  const spread = Math.max(0, Math.min(1, params.spread ?? 0.4)); // lateral fanning
  // Branch fullness is DECOUPLED from leafCount: every tree gets a full skeleton,
  // so a 4-note topic still reads as a tree (just with fewer leaves hung on it).
  const density = Math.max(0.5, params.densityFactor ?? params.crownDensity ?? 1.3);
  const branchBudget = Math.min(220, Math.max(30, Math.round(48 * density)));
  const maxDepth = Math.min(9, Math.max(5, Math.round(Math.log2(branchBudget + 1)) + 2));

  const crownBaseY = trunkLength;
  const crownTopY = trunkLength + crownHeight;

  // Per-tree crown lean for asymmetric species (grows with height, seeded once).
  const leanX = (rng() - 0.5) * 2 * irregularity * crownWidth * 0.6;
  const leanZ = (rng() - 0.5) * 2 * irregularity * crownWidth * 0.6;

  // Radius fraction [0,1] of crownWidth at normalized crown height t∈[0,1].
  // Each species profile gives a recognizably different silhouette.
  function radiusFrac(t: number): number {
    const c = Math.max(0, Math.min(1, t));
    switch (shape) {
      case "cone":
        return 1 - c; // widest at the base
      case "spire":
        return Math.max(0.14, Math.pow(1 - c, 1.15)); // narrow, tapering (keeps some body)
      case "columnar":
        return Math.pow(Math.sin(Math.PI * c), 0.35); // full for most of its height
      case "mound":
        return Math.sqrt(Math.max(0, 1 - Math.pow((c - 0.28) / 0.72, 2))); // widest low
      case "spreading":
        return Math.sqrt(Math.max(0, 1 - Math.pow((c - 0.72) / 0.72, 2))); // widest upper third
      case "umbrella":
        // top-heavy but no thin pinch at the base (avoids a bunched tangle there)
        return 0.35 + 0.65 * Math.sqrt(Math.max(0, 1 - Math.pow((c - 0.78) / 0.78, 2)));
      case "oval":
        return Math.sqrt(Math.max(0, 1 - Math.pow(2 * c - 1, 2))) * (0.7 + 0.3 * c);
      case "ellipsoid":
      case "weeping":
      case "irregular":
      default:
        return Math.sqrt(Math.max(0, 1 - Math.pow(2 * c - 1, 2))); // widest in the middle
    }
  }

  // Pull a point back inside the species crown envelope, so recursion fills a
  // recognizable silhouette instead of sprawling. Axis leans with height.
  function clampToEnvelope(p: Vec3): Vec3 {
    const t = (p.y - crownBaseY) / crownHeight;
    if (t <= 0) return p; // trunk region, no crown limit
    const axX = leanX * Math.min(1, t);
    const axZ = leanZ * Math.min(1, t);
    const maxR = crownWidth * radiusFrac(t) * 1.06 + crownWidth * 0.04;
    const dx = p.x - axX;
    const dz = p.z - axZ;
    const r = Math.hypot(dx, dz);
    if (r > maxR && r > 1e-6) {
      const s = maxR / r;
      return { x: axX + dx * s, y: p.y, z: axZ + dz * s };
    }
    return p;
  }

  const segments: Segment[] = [];
  const crownPts: Vec3[] = []; // foliage anchors spread across the crown
  const FOLIAGE_MIN_DEPTH = 2; // leaves ride finer branches, not the trunk/big limbs

  // Base internode length so the leader roughly spans crownHeight over maxDepth
  // levels (geometric sum of lengthDecay^level).
  const geo = (1 - Math.pow(lengthDecay, maxDepth)) / (1 - lengthDecay);
  const baseLen = crownHeight / Math.max(1e-3, geo);

  let whorlYaw = rng() * Math.PI * 2; // rotate each whorl so levels interleave in 3D

  function grow(start: Vec3, dir: Vec3, len: number, depth: number, budget: number) {
    let end = add(start, scale(dir, len));
    end = clampToEnvelope(end);
    segments.push({ start, end, depth, radius: baseRadius * Math.pow(taper, Math.min(depth, 12)) });
    if (depth >= FOLIAGE_MIN_DEPTH && end.y >= crownBaseY) crownPts.push(end);

    if (budget <= 1 || depth >= maxDepth || len < baseLen * 0.12) {
      crownPts.push(end); // terminal tip is always a foliage anchor
      return;
    }

    const [side, upv] = perpBasis(dir);
    // A radial WHORL: laterals spaced evenly around the axis (balanced ring) plus
    // a central leader that keeps climbing. Even azimuth spacing is what makes the
    // crown grow symmetrically around the trunk line instead of leaning one way.
    const nLat = rng() < 0.5 ? 2 : 3;
    const w0 = 1 + apicalBias * 3; // leader's share of the growth budget
    const wsum = w0 + nLat;
    const leaderBudget = Math.floor((budget * w0) / wsum);
    const latBudget = Math.max(1, Math.floor((budget - leaderBudget) / nLat));

    whorlYaw += GOLDEN_ANGLE;
    for (let j = 0; j < nLat; j++) {
      // evenly spaced around the axis (+ small jitter for organic variation)
      const az = whorlYaw + (j / nLat) * Math.PI * 2 + (rng() - 0.5) * 0.35;
      const pitch = branchAngle * (0.85 + 0.3 * rng());
      const perp = add(scale(side, Math.cos(az)), scale(upv, Math.sin(az)));
      let childDir = norm(add(scale(dir, Math.cos(pitch)), scale(perp, Math.sin(pitch))));
      // Spread: bend laterals toward horizontal (stronger higher up) for a wide,
      // rounded crown. Only damp the upward component, never force a droop.
      if (spread > 0 && childDir.y > 0) {
        const s = spread * Math.min(1, (depth + 1) / 2);
        childDir = norm({ x: childDir.x, y: childDir.y * (1 - s), z: childDir.z });
      }
      // Weeping species: bend laterals downward, stronger toward the tips.
      if (leafDroop > 0) {
        const d = leafDroop * Math.min(1, depth / Math.max(1, maxDepth * 0.5));
        childDir = norm({ x: childDir.x, y: childDir.y - d * 0.95, z: childDir.z });
      }
      childDir = wobbleDir(childDir, wobble, rng);
      grow(end, childDir, len * lengthDecay * (0.8 + 0.12 * rng()), depth + 1, latBudget);
    }

    // Central leader: climbs nearly straight (tiny pitch) so a trunk line runs up
    // through the crown and the whole tree stays organized around that axis.
    if (leaderBudget >= 1) {
      const lp = branchAngle * 0.18;
      const perp = add(scale(side, Math.cos(whorlYaw)), scale(upv, Math.sin(whorlYaw)));
      let leaderDir = norm(add(scale(dir, Math.cos(lp)), scale(perp, Math.sin(lp))));
      leaderDir = wobbleDir(leaderDir, wobble * 0.5, rng);
      grow(end, leaderDir, len * lengthDecay, depth + 1, leaderBudget);
    }
  }

  // Dead-straight vertical trunk up to the crown base, so the crown is centred on
  // a clean central axis (no drift, no lean). Then recurse the crown from its top.
  const stemStart: Vec3 = { x: 0, y: 0, z: 0 };
  const stemDir: Vec3 = { x: 0, y: 1, z: 0 };
  if (trunkLength > 0) {
    segments.push({ start: stemStart, end: { x: 0, y: trunkLength, z: 0 }, depth: 0, radius: baseRadius });
  }
  grow({ x: 0, y: trunkLength, z: 0 }, stemDir, baseLen, 1, branchBudget);

  // ── distribute exactly leafCount leaves across the crown anchors ─────────────
  // Anchors are spread through the whole crown (every finer branch end), so a
  // random subset stays spread - foliage never clumps at the tips.
  for (let i = crownPts.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = crownPts[i];
    crownPts[i] = crownPts[j];
    crownPts[j] = tmp;
  }
  const jr = crownWidth * 0.06; // small jitter so leaves read as foliage, not dots
  const sites: Vec3[] = [];
  const anchorN = crownPts.length || 1;
  for (let i = 0; i < leafCount; i++) {
    const a = crownPts[i % anchorN] ?? { x: 0, y: crownTopY, z: 0 };
    sites.push({
      x: a.x + (rng() - 0.5) * 2 * jr,
      y: a.y + (rng() - 0.5) * 2 * jr,
      z: a.z + (rng() - 0.5) * 2 * jr,
    });
  }

  // Weeping species: a little extra downward settle on the foliage (the branches
  // already droop via the grower); small so leaves stay on their branches.
  if (leafDroop > 0) {
    for (const s of sites) {
      const rad = Math.hypot(s.x - leanX, s.z - leanZ) / (crownWidth || 1);
      s.y -= leafDroop * crownHeight * 0.12 * (0.3 + 0.7 * Math.min(1, rad));
    }
  }

  // Rank leaves by height (lowest first) so index 0 = base, last = tip. The
  // timeline scrubber grows oldest->newest by this index, so it is load-bearing.
  const ordered = sites
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
  if (height <= 0) height = crownTopY;
  if (radius <= 0) radius = crownWidth;

  return { segments, leaves, height, radius };
}
