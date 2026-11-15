import { hash2, mulberry32 } from '../noise';
import { MESH, STYLE } from './CityLayout';
import { PROP } from './props';

/**
 * The working harbours along the bay (pure, like the layout): a superblock-wide stretch of
 * shore with two concrete piers running out into the water, ship-to-shore gantry cranes on
 * them with their booms over the berths, stacks of shipping containers, a cargo ship alongside
 * and small boats moored down the piers. Behind the seawall the waterfront blocks become a
 * container yard (the layout's BK.HARBOUR). One is always just west of the spawn, so the
 * first look along the bay shows it.
 *
 * Every solid is clipped to the superblock that asks (each one indexes only its own boxes), and
 * a part is drawn by the superblock holding its centre, so a pier crossing a superblock line is
 * still whole and solid.
 */

/** What the harbour builds with (the layout's own part, solid and prop writers). */
export interface HarbourSink {
  readonly S: number;
  readonly seed: number;
  shoreNear(x: number): number;
  shoreFar(x: number): number;
  bankDist(x: number, z: number): number;
  addPart(
    mesh: number,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    rot: number,
    color: number,
    style: number,
    seed: number,
  ): void;
  addSolid(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void;
  addProp(
    kind: number,
    x: number,
    y: number,
    z: number,
    rot: number,
    sx: number,
    sy: number,
    sz: number,
    tint: number,
  ): void;
}

/** Pier half width and length (m), deck height. */
export const PIER_HALF = 9;
export const PIER_LENGTH = 95;
export const PIER_DECK = 2.6;
/** Piers stand this far into their superblock from its west edge (clear of the avenues). */
export const PIER_AT = [78, 168] as const;

const CRANE_COLORS = [0xd0473a, 0x2f6f9f, 0xe0a33a];
const CONTAINERS = [
  0xb8452f, 0x2f5f8f, 0x3f7f5a, 0xd09a3a, 0x8a8f96, 0xe2e0d8, 0x9a4a6f, 0x4a8fa8, 0xc8733a,
];
const HULLS = [0x2f3f5f, 0x8a2f2f, 0x2f5a4a, 0x3a3a44];

/** A harbour on this superblock column's stretch of shore? side 1 the near shore, -1 the far. */
export function harbourAt(seed: number, I: number, side: number): boolean {
  if (side > 0 && I === -2) return true; // west of the spawn, in view from the start
  if (Math.abs(I) <= 1) return false; // never across the spawn's view of the torii
  return hash2(I, side, seed + 701) < 0.16;
}

/**
 * Build superblock (I, J)'s share of the harbour on the given side's shore. `inJ` says whether
 * a point's z falls in this superblock (parts by their centre); solids are clipped to it.
 */
export function genHarbour(H: HarbourSink, I: number, J: number, side: number): void {
  const S = H.S;
  const z0 = J * S;
  const z1 = z0 + S;
  const inJ = (z: number) => z >= z0 && z < z1;
  const solid = (x0: number, y0: number, za: number, x1: number, y1: number, zb: number) => {
    const a = Math.max(Math.min(za, zb), z0);
    const b = Math.min(Math.max(za, zb), z1);
    if (b > a) H.addSolid(x0, y0, a, x1, y1, b);
  };
  /** A box part (drawn by its centre's superblock) and, if asked, its solid. */
  const box = (
    x0: number,
    za: number,
    x1: number,
    zb: number,
    y0: number,
    y1: number,
    color: number,
    style: number,
    seed: number,
    isSolid = true,
  ) => {
    const cz = (za + zb) / 2;
    if (inJ(cz))
      H.addPart(
        MESH.BOX,
        (x0 + x1) / 2,
        y0,
        cz,
        x1 - x0,
        y1 - y0,
        Math.abs(zb - za),
        0,
        color,
        style,
        seed,
      );
    if (isSolid) solid(x0, y0, za, x1, y1, zb);
  };
  for (let p = 0; p < PIER_AT.length; p++) {
    const px = I * S + PIER_AT[p];
    const edge = side > 0 ? H.shoreNear(px) : H.shoreFar(px);
    // Along the pier: a = metres out from the seawall, toward the water (+z on the near shore).
    const zAt = (a: number) => edge + side * a;
    // Never across a river's mouth: the river walk and its bridge need the shore open.
    let wet = false;
    for (let a = -30; a <= PIER_LENGTH + 20; a += 15)
      for (const dx of [-PIER_HALF - 30, 0, PIER_HALF + 30])
        wet ||= H.bankDist(px + dx, zAt(a)) < 25;
    if (wet) continue;
    const rnd = mulberry32((hash2(I * 2 + p, side, H.seed + 711) * 4294967296) >>> 0);
    // The pier: a concrete deck on a solid quay wall down to the seabed, a pale coping.
    box(
      px - PIER_HALF,
      zAt(-3),
      px + PIER_HALF,
      zAt(PIER_LENGTH),
      -7,
      PIER_DECK,
      0xa9a39b,
      STYLE.PLAIN,
      0,
    );
    for (const sx of [-1, 1])
      box(
        px + sx * (PIER_HALF - 0.4) - 0.4,
        zAt(0),
        px + sx * (PIER_HALF - 0.4) + 0.4,
        zAt(PIER_LENGTH),
        PIER_DECK,
        PIER_DECK + 0.35,
        0xd8d2c6,
        STYLE.PLAIN,
        0,
        false,
      );
    // Two gantry cranes riding the pier, booms out over the water on the ship's side.
    const shipSide = rnd() < 0.5 ? -1 : 1;
    const color = CRANE_COLORS[Math.floor(rnd() * CRANE_COLORS.length)];
    for (const a of [30, 66]) {
      const cz = zAt(a);
      const H0 = PIER_DECK;
      const top = H0 + 32;
      // Four legs, the portal beams on top, a machinery house, the boom and its A-frame.
      for (const lx of [-1, 1])
        for (const lz of [-1, 1])
          box(
            px + lx * 6.5 - 0.6,
            cz + lz * 6 - 0.6,
            px + lx * 6.5 + 0.6,
            cz + lz * 6 + 0.6,
            H0,
            top,
            color,
            STYLE.PLAIN,
            0,
          );
      for (const lz of [-1, 1])
        box(
          px - 7.4,
          cz + lz * 6 - 0.8,
          px + 7.4,
          cz + lz * 6 + 0.8,
          top,
          top + 2.4,
          color,
          STYLE.PLAIN,
          0,
        );
      box(px - 7.4, cz - 6, px + 7.4, cz + 6, H0 + 9, H0 + 10.2, color, STYLE.PLAIN, 0, false);
      const bx0 = shipSide > 0 ? px - 18 : px - 36;
      const bx1 = shipSide > 0 ? px + 36 : px + 18;
      box(bx0, cz - 1.2, bx1, cz + 1.2, top + 2.4, top + 4.4, color, STYLE.PLAIN, 0);
      box(px - 5, cz - 3.5, px + 5, cz + 3.5, top + 2.4, top + 7, 0xe9e3d6, STYLE.OFFICE, rnd());
      box(
        px + shipSide * 2 - 0.7,
        cz - 0.7,
        px + shipSide * 2 + 0.7,
        cz + 0.7,
        top + 7,
        top + 16,
        color,
        STYLE.PLAIN,
        0,
      );
      // The driver's cab under the boom.
      box(
        px + shipSide * 14 - 1.5,
        cz - 1.4,
        px + shipSide * 14 + 1.5,
        cz + 1.4,
        top - 0.6,
        top + 2.4,
        0xe9e3d6,
        STYLE.OFFICE,
        rnd(),
      );
      // A red light on the A-frame.
      if (inJ(cz))
        H.addPart(
          MESH.BOX,
          px + shipSide * 2,
          top + 16,
          cz,
          1,
          1,
          1,
          0,
          0xff3b30,
          STYLE.BEACON,
          rnd(),
        );
    }
    // Containers stacked on the pier between and behind the cranes (40 ft boxes, 1-3 high).
    for (const [a0, rows] of [
      [42, 2],
      [78, 1],
    ] as const)
      for (let r = 0; r < rows * 2; r++) {
        const zc = zAt(a0 + r * 2.7);
        for (const cx of [-3.2, 3.2]) {
          const n = 1 + Math.floor(rnd() * 3);
          for (let k = 0; k < n; k++) {
            const y = PIER_DECK + k * 2.6;
            box(
              px + cx - 6.1,
              zc - 1.2,
              px + cx + 6.1,
              zc + 1.2,
              y,
              y + 2.55,
              CONTAINERS[Math.floor(rnd() * CONTAINERS.length)],
              STYLE.CONTAINER,
              rnd(),
              false,
            );
          }
          // One solid for the whole stack (its top), the parts above stand on it.
          solid(px + cx - 6.1, PIER_DECK, zc - 1.2, px + cx + 6.1, PIER_DECK + n * 2.6, zc + 1.2);
        }
      }
    // A cargo ship alongside, under the booms: hull, deck cargo, the bridge house aft.
    if (p === 0 || rnd() < 0.5) {
      const sx = px + shipSide * (PIER_HALF + 9);
      const za = zAt(14);
      const zb = zAt(88);
      const hull = HULLS[Math.floor(rnd() * HULLS.length)];
      box(sx - 8, za, sx + 8, zb, -4, 4.5, hull, STYLE.PLAIN, 0);
      box(sx - 8.05, za, sx + 8.05, zb, 3.4, 4.5, 0xe2e0d8, STYLE.PLAIN, 0, false);
      for (let a = 22; a < 70; a += 6.5) {
        const zc = zAt(a);
        const n = 1 + Math.floor(rnd() * 3);
        box(
          sx - 6.6,
          zc - 3,
          sx + 6.6,
          zc + 3,
          4.5,
          4.5 + n * 2.6,
          CONTAINERS[Math.floor(rnd() * CONTAINERS.length)],
          STYLE.CONTAINER,
          rnd(),
        );
      }
      const zh = zAt(78);
      box(sx - 7, zh - 4, sx + 7, zh + 4, 4.5, 16, 0xf2efe8, STYLE.APART, rnd());
      box(sx - 1.2, zh - 1.2, sx + 1.2, zh + 1.2, 16, 21, hull, STYLE.PLAIN, 0);
    }
    // Small boats moored down the far side of the pier, bows to the shore.
    const boatSide = -shipSide;
    for (let a = 12; a < PIER_LENGTH - 6; a += 10.5) {
      if (rnd() < 0.3) continue;
      const bz = zAt(a);
      if (!inJ(bz)) continue;
      H.addProp(
        PROP.Boat,
        px + boatSide * (PIER_HALF + 1.9),
        -0.25,
        bz,
        side > 0 ? Math.PI / 2 : -Math.PI / 2,
        0.8 + rnd() * 0.5,
        1,
        0.8 + rnd() * 0.3,
        rnd(),
      );
    }
    // Bollards' worth of life on the deck: lamps down the middle.
    for (let a = 8; a < PIER_LENGTH; a += 24) {
      const lz = zAt(a);
      if (inJ(lz))
        H.addProp(
          PROP.Lamp,
          px - boatSide * 0.5,
          PIER_DECK,
          lz,
          boatSide * (Math.PI / 2),
          1.2,
          1.3,
          1.2,
          0,
        );
    }
  }
}
