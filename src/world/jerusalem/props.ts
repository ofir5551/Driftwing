/**
 * City of Gold's small scenery as flat number records (pure: shared by the layout, which puts
 * rooftop clutter and market awnings on its houses, the scatter, which fills the hills, the
 * decor, which instances them, and the tests).
 */

/** Prop kinds (index into the decor's meshes). */
export const PROP = {
  Outcrop: 0, // pale limestone shelf, bedded in courses
  Boulder: 1, // loose stones on the slopes and by the paths
  Scrub: 2, // grey-green garrigue: thorny burnet, sage
  Oleander: 3, // dark-leaved bushes in pink flower along the wadi beds
  Wall: 4, // a metre of dry-stone wall (terraces, fields, roadsides), scaled along x
  Goat: 5,
  Sheep: 6,
  Shepherd: 7,
  Tanks: 8, // rooftop water tanks on a frame
  Laundry: 9, // a washing line between two posts
  Pots: 10, // potted plants on a roof or a step
  Awning: 11, // a market stall: a striped canvas on poles over a table of produce
  Swift: 12, // swifts wheeling over the roofs
} as const;
export const PROP_KINDS = 13;

/** Floats per prop: kind, x, y (base), z, yaw, tilt (about local z: a wall follows the slope), sx, sy, sz, tint (0..1). */
export const PROP_STRIDE = 10;

export function pushProp(
  out: number[],
  kind: number,
  x: number,
  y: number,
  z: number,
  yaw: number,
  tilt: number,
  sx: number,
  sy: number,
  sz: number,
  tint: number,
): void {
  out.push(kind, x, y, z, yaw, tilt, sx, sy, sz, tint);
}

/**
 * Height of each kind at scale 1 (m): what the bird and the wisps must clear, and a test's
 * bound. A wall's is its height; walls are scaled in y to the step they retain.
 */
export const PROP_HEIGHT = [2.2, 1.2, 1.1, 2.8, 1, 1.1, 1.1, 1.8, 1.9, 1.8, 1.1, 3, 0];
/** Footprint radius of each kind at scale 1 (m), for clearance tests (walls: half thickness). */
export const PROP_RADIUS = [2.4, 1.2, 1.1, 1.8, 0.45, 0.8, 0.8, 0.4, 1.4, 2.2, 0.8, 2.2, 0];
