/**
 * Neon Bay's small things (street furniture, rooftop clutter, moored boats) as flat records, so
 * the layout that places them stays pure: kind, x, y (base), z, yaw, sx, sy, sz, tint (0..1).
 */
export const PROP = {
  /** Street lamp: pole, arm over the road (local +z), a head that glows after dark. */
  Lamp: 0,
  /** Concrete utility pole with a crossarm and a transformer. */
  Pole: 1,
  /** Three sagging cables between two poles (length along local x = sx). */
  Wire: 2,
  /** Traffic signal: pole, an arm over the road (local +z) and the lamp head. */
  Signal: 3,
  /** A pair of vending machines, fronts glowing (local +z). */
  Vending: 4,
  /** Bench facing local +z. */
  Bench: 5,
  /** Bus shelter open to local +z, its ad panel lit. */
  BusStop: 6,
  /** Tree pit: a kerbed square of dark soil under a street tree. */
  Pit: 7,
  /** Planter box of clipped shrubs. */
  Planter: 8,
  /** Rooftop: a water tank on a stand and air-conditioning units. */
  RoofA: 9,
  /** Rooftop: an antenna mast, a row of condensers and a stair hut. */
  RoofB: 10,
  /** A parapet round a flat roof (sx, sz the roof; its wall is a fixed thickness). */
  Parapet: 11,
  /** A small boat moored at a pier or along a quay (bow along local +x). */
  Boat: 12,
} as const;
export const PROP_KINDS = 13;
export const PROP_STRIDE = 9;

/** Kinds drawn only within smallPropDistance (the rest within propDistance). */
export const PROP_SMALL = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0];
