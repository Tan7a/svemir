/**
 * Idea Garden - tree species presets.
 *
 * Ten distinct tree silhouettes derived from a reference DXF of architectural
 * elevation trees (crown shape, width:height ratio, trunk proportion, foliage
 * density measured per tree). Each topic is mapped to exactly one species by a
 * hash of its name, so a topic always renders as the same kind of tree, with a
 * small seeded jitter within the species so same-species topics still differ.
 *
 * This is the single tunable config object for tree shape. To retune the garden,
 * edit SPECIES below. It feeds `buildPlant` (recursive tree grower) in ./lsystem
 * - it does not change any data, layout, or interaction.
 */

import { seedFromId, type CrownShape, type PlantParams } from "./lsystem";

export type Species = {
  /** stable key (for debugging / test forest labels). */
  key: string;
  /** crown envelope silhouette (see CrownShape). */
  crownShape: CrownShape;
  /** crown diameter : crown height. <1 = taller than wide. */
  ar: number;
  /** bare trunk as a fraction of total tree height. */
  trunkRatio: number;
  /** branch skeleton fullness (decoupled from note count). Higher = twiggier. */
  density: number;
  /** overall height relative to BASE_HEIGHT (the "taller/heftier" dial). */
  heightScale: number;
  /** branch divergence from parent, degrees. Small = narrow/upright, large = fanning. */
  branchAngle: number;
  /** 0-1 apical dominance: how strongly the central leader keeps growing (tall
   * narrow forms high, spreading forms low). */
  apical: number;
  /** 0-1 how strongly laterals bend toward horizontal (wide canopy). */
  spread: number;
  /** branch length shrink per level. Default 0.82. */
  lengthDecay?: number;
  /** 0-1 downward foliage droop (weeping forms). Default 0. */
  leafDroop?: number;
  /** 0-1 crown asymmetry / lean. Default 0. */
  irregularity?: number;
  /** leaf instance geometry index (0 ball, 1 cube, 2 diamond) for extra
   * per-species distinctness. Consumed by the renderer. */
  leafShape: number;
};

/**
 * The ten species, measured from the reference DXF elevation trees (see the
 * silhouette metrics: aspect ratio, trunk fraction, widest-band, density).
 */
// All species are wide-branched: big crown (ar), open branch angle, low leader
// dominance, high spread - so branches fan out and never collapse into a thin
// vertical tangle. Ten crown shapes keep them distinct.
export const SPECIES: Species[] = [
  // #0 big broad deciduous - wide rounded crown widest in the upper third.
  { key: "broad-spreading", crownShape: "spreading", ar: 1.15, trunkRatio: 0.24, density: 1.7, heightScale: 1.1, branchAngle: 44, apical: 0.28, spread: 0.72, irregularity: 0.15, leafShape: 0 },
  // #1 wide flat-topped crown on an open stem.
  { key: "umbrella", crownShape: "umbrella", ar: 1.4, trunkRatio: 0.32, density: 1.5, heightScale: 1.0, branchAngle: 48, apical: 0.18, spread: 0.85, leafShape: 0 },
  // #2 rounded egg-shaped crown, medium.
  { key: "rounded-oval", crownShape: "oval", ar: 0.92, trunkRatio: 0.28, density: 1.6, heightScale: 1.0, branchAngle: 40, apical: 0.32, spread: 0.62, leafShape: 0 },
  // #3 broad ball crown on a clear stem (replaces the old thin columnar).
  { key: "broad-round", crownShape: "ellipsoid", ar: 1.05, trunkRatio: 0.26, density: 1.7, heightScale: 1.05, branchAngle: 44, apical: 0.3, spread: 0.68, leafShape: 0 },
  // #4 wide upright asymmetric tree.
  { key: "upright-irregular", crownShape: "irregular", ar: 0.88, trunkRatio: 0.2, density: 1.35, heightScale: 1.0, branchAngle: 42, apical: 0.34, spread: 0.6, irregularity: 0.4, leafShape: 2 },
  // #5 broad pyramidal conifer, wide at the base (fir).
  { key: "conical", crownShape: "cone", ar: 0.95, trunkRatio: 0.05, density: 1.95, heightScale: 1.1, branchAngle: 40, apical: 0.42, spread: 0.5, leafShape: 2 },
  // #6 wide crown held high on a longer trunk.
  { key: "high-crown", crownShape: "ellipsoid", ar: 0.9, trunkRatio: 0.4, density: 1.45, heightScale: 1.05, branchAngle: 42, apical: 0.34, spread: 0.62, leafShape: 0 },
  // #7 open rounded crown with a visible branch armature.
  { key: "open-round", crownShape: "ellipsoid", ar: 0.85, trunkRatio: 0.3, density: 1.2, heightScale: 0.95, branchAngle: 46, apical: 0.38, spread: 0.6, leafShape: 1 },
  // #8 low broad mound, widest near the base (replaces the old thin spire).
  { key: "broad-mound", crownShape: "mound", ar: 1.2, trunkRatio: 0.16, density: 1.8, heightScale: 0.95, branchAngle: 48, apical: 0.24, spread: 0.78, leafShape: 0 },
  // #9 weeping crown, foliage drapes downward (willow).
  { key: "weeping", crownShape: "weeping", ar: 1.05, trunkRatio: 0.28, density: 1.6, heightScale: 1.0, branchAngle: 46, apical: 0.22, spread: 0.62, leafDroop: 0.45, irregularity: 0.1, leafShape: 0 },
];

/** Base tree height in world units. The single lever for overall tree size;
 * bumped above the previous garden's ~35u so trees read taller and heftier. */
export const BASE_HEIGHT = 52;

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Deterministically map a topic name to one of the ten species. */
export function pickSpecies(name: string): Species {
  return SPECIES[seedFromId(name || "x") % SPECIES.length];
}

/** Concrete `buildPlant` params for a species. `rng` supplies the small
 * within-species jitter (seed it from the topic name for determinism);
 * `leafCount` mildly scales the tree so richer topics grow a little larger.
 * Returns everything except `leafCount`/`seed`, which the caller supplies. */
/** Leaf count that fills a BASE_HEIGHT crown at a natural density. Crown size
 * scales with the cube root of leafCount around this, so foliage density stays
 * roughly constant: few-note topics are small saplings, rich topics big trees. */
const REF_LEAVES = 55;

export function speciesParams(
  sp: Species,
  rng: () => number,
  leafCount: number
): Omit<PlantParams, "leafCount" | "seed"> {
  // Size grows with note count but on a high floor, so every topic is a
  // substantial tree ("bigger overall") while rich topics still grow tallest.
  // The cube root keeps the spread gentle; the floor keeps small topics big.
  const norm = Math.cbrt(Math.max(1, leafCount) / REF_LEAVES); // ~0.26 .. ~1.7
  const sizeF = clamp(0.9 + 0.55 * norm, 0.9, 1.7);
  const height = BASE_HEIGHT * sp.heightScale * sizeF * (0.94 + rng() * 0.14);
  const trunkRatio = clamp(sp.trunkRatio + (rng() - 0.5) * 0.06, 0, 0.6);
  const trunkLength = height * trunkRatio;
  const crownHeight = height - trunkLength;
  const ar = sp.ar * (0.92 + rng() * 0.16);
  const crownWidth = (crownHeight * ar) / 2; // radius at the widest point

  return {
    crownShape: sp.crownShape,
    crownHeight,
    crownWidth,
    trunkLength,
    // Recursion / structure. branchAngle + apical + spread give each species its
    // shape; density sets skeleton fullness (independent of note count).
    branchAngleDeg: sp.branchAngle * (0.92 + rng() * 0.16),
    apicalBias: clamp(sp.apical + (rng() - 0.5) * 0.1, 0, 0.9),
    spread: clamp(sp.spread + (rng() - 0.5) * 0.1, 0, 1),
    lengthDecay: sp.lengthDecay ?? 0.82,
    densityFactor: sp.density * (0.9 + rng() * 0.2),
    leafDroop: sp.leafDroop ?? 0,
    // No sideways lean: crowns grow symmetrically around the central trunk axis.
    irregularity: 0,
    baseRadius: 0.05,
    taper: 0.82,
    wobble: 0.05, // gentle; too much reads as disordered / lopsided
  };
}
