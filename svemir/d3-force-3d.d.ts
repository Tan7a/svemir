// d3-force-3d ships no TypeScript types. We only use a few force factories
// (forceCollide / forceX / forceY) via react-force-graph's d3Force accessor, so
// a loose ambient declaration is enough.
declare module "d3-force-3d";
