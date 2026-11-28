import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { smoothstep } from '../../core/math';
import { colored, jitter, painted } from '../Trees';
import { eaveRoof } from '../karst/shapes';
import { anim } from '../atoll/shapes';
import { HALL, PAGODA_HEIGHT, PAVILION, SHRINE } from './MapleLayout';
import { LIFE_CROW } from './materials';

/**
 * Maple Valley's buildings and things, in metres from primitives, painted per vertex: a
 * five-storey pagoda, a temple hall and a hillside shrine under swept, upturned eaves, the
 * vermilion gates (one shape scaled per gate), an arched drum bridge (a unit shape stretched to
 * its span), stone lanterns, thatched farmhouses, the lake's three-storey pavilion, floating
 * paper lanterns, herons, deer and mossy boulders. The big ones have cheap far shapes.
 */

const VERMILION = '#c8452f';
const VERMILION_DARK = '#9c3426';
const PLASTER = '#efe6d2';
const TILE = '#454a4f';
const STONE = '#9a978e';
const WOOD = '#5e4232';
const GILT = '#d9ad4a';

/** A square eave skirt: flared out and down from a wall of half side r0 to r1, corners curled. */
function squareEaves(r0: number, r1: number, drop: number, curl: number, hex: string) {
  const pos: number[] = [];
  const idx: number[] = [];
  const n = 16;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + Math.PI / 4;
    // A square: radius to its edge at this angle, the corners (every fourth) curling up.
    const c = Math.cos(a);
    const s = Math.sin(a);
    const sq = 1 / Math.max(Math.abs(c), Math.abs(s));
    const corner = k % 4 === 0;
    const lift = corner ? curl : k % 2 ? 0 : curl * 0.25;
    pos.push(
      c * r0 * sq,
      0,
      s * r0 * sq,
      c * r1 * sq,
      -drop + lift,
      s * r1 * sq,
      c * r1 * sq * 0.97,
      -drop + lift - 0.2,
      s * r1 * sq * 0.97,
    );
  }
  for (let k = 0; k < n; k++) {
    const a = k * 3;
    const b = ((k + 1) % n) * 3;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
    idx.push(a + 1, b + 1, a + 2, b + 1, b + 2, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const base = new THREE.Color(hex);
  return painted(g, (_x, y, _z, out) => out.copy(base).multiplyScalar(0.85 + 0.3 * (y + drop)));
}

/**
 * A five-storey pagoda (~450 triangles): a stone plinth, square storeys of white plaster
 * between vermilion posts and a band of brackets, each under a wide skirt of dark tile eaves
 * curling up at the corners, narrowing upward, and a bronze spire of rings to a gilt jewel.
 * PAGODA_HEIGHT tall; the widest eave is PAGODA_R.
 */
export function pagodaGeometry(): THREE.BufferGeometry {
  const parts = [colored(new THREE.BoxGeometry(9.6, 1.1, 9.6), STONE, 0.55)];
  let y = 1.1;
  for (let k = 0; k < 5; k++) {
    const r = 3.3 - k * 0.32;
    const h = k === 0 ? 3.3 : 2.5;
    // White plaster between vermilion corner posts, a red band of brackets under the eaves.
    parts.push(colored(new THREE.BoxGeometry(r * 2 - 0.2, h, r * 2 - 0.2), PLASTER, y + h / 2));
    for (const x of [-1, 1])
      for (const z of [-1, 1])
        parts.push(
          colored(new THREE.BoxGeometry(0.42, h, 0.42), VERMILION, y + h / 2).translate(
            x * (r - 0.12),
            0,
            z * (r - 0.12),
          ),
        );
    parts.push(
      colored(new THREE.BoxGeometry(r * 2 + 0.3, 0.55, r * 2 + 0.3), VERMILION, y + h - 0.27),
    );
    y += h;
    parts.push(squareEaves(r - 0.05, r + 3.2 - k * 0.2, 1.2, 0.95, TILE).translate(0, y + 1.15, 0));
    y += 0.55;
  }
  parts.push(colored(new THREE.ConeGeometry(1.4, 1.2, 4).rotateY(Math.PI / 4), TILE, y + 0.6));
  const spire = PAGODA_HEIGHT - y - 1.6;
  parts.push(
    colored(new THREE.CylinderGeometry(0.12, 0.18, spire, 5), '#8c7a52', y + 1.2 + spire / 2),
  );
  for (let k = 0; k < 7; k++)
    parts.push(
      colored(new THREE.CylinderGeometry(0.55, 0.55, 0.16, 8), '#9b8656', y + 2.2 + k * 0.62),
    );
  parts.push(colored(new THREE.SphereGeometry(0.42, 6, 4), GILT, PAGODA_HEIGHT - 0.4));
  return mergeGeometries(parts)!;
}

/** Far pagoda (~80 triangles): the storeys as one tapering column under five flat skirts. */
export function pagodaFarGeometry(): THREE.BufferGeometry {
  const parts = [
    colored(new THREE.CylinderGeometry(2.2, 3.2, 17, 4, 1).rotateY(Math.PI / 4), PLASTER, 9.6),
  ];
  let y = 4.4;
  for (let k = 0; k < 5; k++) {
    const r = 6 - k * 0.45;
    parts.push(
      colored(new THREE.CylinderGeometry(r * 0.55, r, 0.9, 4, 1).rotateY(Math.PI / 4), TILE, y),
    );
    y += k === 0 ? 3.9 : 3.05;
  }
  parts.push(colored(new THREE.CylinderGeometry(0.15, 0.2, 10, 4), '#8c7a52', PAGODA_HEIGHT - 5));
  return mergeGeometries(parts)!;
}

/**
 * A temple hall (~300 triangles): a stone terrace, a vermilion colonnade round white walls with
 * a dark door, and a great hipped roof of dark tile in two tiers, swept and curling. Front faces
 * +z; HALL.h tall, its length along x.
 */
export function hallGeometry(): THREE.BufferGeometry {
  const W = HALL.a * 1.6;
  const D = HALL.b * 1.4;
  const parts = [
    colored(new THREE.BoxGeometry(W + 3.6, 1, D + 4), STONE, 0.5),
    colored(new THREE.BoxGeometry(W, 4.6, D), PLASTER, 1 + 2.3),
    colored(new THREE.PlaneGeometry(3.2, 3.2), '#3b2a22').translate(0, 2.6, D / 2 + 0.02),
    colored(new THREE.BoxGeometry(W + 0.3, 0.6, D + 0.3), VERMILION, 1 + 4.3),
  ];
  for (let k = 0; k < 7; k++)
    for (const s of [-1, 1])
      parts.push(
        colored(new THREE.CylinderGeometry(0.26, 0.28, 4.6, 6), VERMILION, 1 + 2.3).translate(
          -W / 2 - 0.6 + (k * (W + 1.2)) / 6,
          0,
          s * (D / 2 + 1.1),
        ),
      );
  parts.push(eaveRoof(W / 2 + 2.6, D / 2 + 3.2, 1.6, 1.3, TILE).translate(0, 5.7, 0));
  parts.push(colored(new THREE.BoxGeometry(W * 0.72, 1.6, D * 0.62), VERMILION_DARK, 7.2));
  parts.push(eaveRoof(W * 0.36 + 1.6, D * 0.31 + 2.2, 2.6, 1.2, TILE).translate(0, 8, 0));
  return mergeGeometries(parts)!;
}

export function hallFarGeometry(): THREE.BufferGeometry {
  const W = HALL.a * 1.6;
  const D = HALL.b * 1.4;
  const roof = new THREE.CylinderGeometry(1, 1, 1, 4, 1).rotateY(Math.PI / 4);
  roof.scale(W * 0.78, 5.4, D * 0.95).translate(0, 8.4, 0);
  return mergeGeometries([
    colored(new THREE.BoxGeometry(W + 2, 5.8, D + 2), PLASTER, 2.9),
    colored(roof, TILE),
  ])!;
}

/** A hillside shrine at a tunnel's top: a little vermilion hall under a swept roof. */
export function shrineGeometry(): THREE.BufferGeometry {
  const W = SHRINE.a * 1.3;
  const D = SHRINE.b * 1.2;
  const parts = [
    colored(new THREE.BoxGeometry(W + 1.6, 0.6, D + 1.8), STONE, 0.3),
    colored(new THREE.BoxGeometry(W, 2.8, D), VERMILION, 0.6 + 1.4),
    colored(new THREE.PlaneGeometry(1.8, 2), PLASTER).translate(0, 1.7, D / 2 + 0.02),
    eaveRoof(W / 2 + 1.2, D / 2 + 1.5, 2.2, 0.9, '#3f4a44').translate(0, 3.4, 0),
  ];
  // A pair of stone lanterns before it.
  for (const s of [-1, 1]) parts.push(stoneLantern().translate(s * (W / 2 + 0.4), 0, D / 2 + 2.2));
  return mergeGeometries(parts)!;
}

/**
 * A gate (~110 triangles), `half` m from its centre to each post and `h` m to the top of its
 * upper beam: two vermilion posts on black feet, a tie beam through them, and the upper beam
 * (red under a black cap) sweeping up at its ends past the posts. Spans x; faces z.
 */
export function gateGeometry(half: number, h: number): THREE.BufferGeometry {
  const post = 0.11 * h ** 0.85;
  const parts: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    parts.push(
      colored(
        new THREE.CylinderGeometry(post * 0.9, post, h - 0.9, 8),
        VERMILION,
        (h - 0.9) / 2,
      ).translate(s * half, 0, 0),
      colored(
        new THREE.CylinderGeometry(post * 1.2, post * 1.25, h * 0.06, 8),
        '#2b2522',
        h * 0.03,
      ).translate(s * half, 0, 0),
    );
  }
  const over = half + post * 4;
  // The tie beam, and the strut between it and the upper beam.
  parts.push(
    colored(new THREE.BoxGeometry(over * 1.85, post * 1.0, post * 0.9), VERMILION, h * 0.74),
  );
  parts.push(
    colored(new THREE.BoxGeometry(post * 1.4, h * 0.12, post * 0.7), VERMILION_DARK, h * 0.84),
  );
  // The upper beam: a bent box, its ends rising (each vertex lifted by how far out it lies).
  const beam = (w: number, t: number, d: number, y: number, hex: string) => {
    const g = new THREE.BoxGeometry(over * 2 * w, t, d, 8, 1, 1);
    const pos = g.getAttribute('position');
    for (let k = 0; k < pos.count; k++) {
      const u = pos.getX(k) / over;
      pos.setY(k, pos.getY(k) + Math.pow(Math.abs(u), 2.4) * h * 0.06);
    }
    return colored(g, hex, y);
  };
  parts.push(beam(1, post * 1.3, post * 1.3, h - post * 1.25, VERMILION));
  parts.push(beam(1.04, post * 0.7, post * 1.55, h - post * 0.3, '#262120'));
  return mergeGeometries(parts)!;
}

/** Far gate (~48 triangles): posts and both beams as plain vermilion boxes. */
export function gateFarGeometry(half: number, h: number): THREE.BufferGeometry {
  const post = 0.11 * h ** 0.85;
  const over = half + post * 4;
  const parts = [
    colored(new THREE.BoxGeometry(over * 2.05, post * 1.8, post * 1.5), VERMILION, h - post * 0.9),
    colored(new THREE.BoxGeometry(over * 1.85, post, post), VERMILION, h * 0.74),
  ];
  for (const s of [-1, 1])
    parts.push(
      colored(new THREE.BoxGeometry(post * 1.8, h, post * 1.8), VERMILION, h / 2).translate(
        s * half,
        0,
        0,
      ),
    );
  return mergeGeometries(parts)!;
}

/**
 * The arched drum bridge as a unit shape: it spans local x from -1 to 1, its deck rising from 0
 * at the ends to 1 at the crown (the layout's `deckY`, a half ellipse), its width z from -1 to 1;
 * the instance scales it to the span, the rise and the width. Vermilion railings with posts.
 */
export function bridgeGeometry(): THREE.BufferGeometry {
  const seg = 16;
  const pos: number[] = [];
  const idx: number[] = [];
  // The deck: a strip with a thickness, arched.
  for (let i = 0; i <= seg; i++) {
    const u = (i / seg) * 2 - 1;
    const y = Math.sqrt(1 - u * u);
    pos.push(u, y, -1, u, y, 1, u, y - 0.12, -1, u, y - 0.12, 1);
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 4;
    const b = a + 4;
    idx.push(a, a + 1, b, a + 1, b + 1, b); // top
    idx.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3); // underside
    idx.push(a, b, a + 2, b, b + 2, a + 2); // side -z
    idx.push(a + 1, a + 3, b + 1, b + 1, a + 3, b + 3); // side +z
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const deck = new THREE.Color('#8a5a40');
  const side = new THREE.Color(VERMILION);
  const parts = [painted(g, (_x, _y, z, out) => out.copy(Math.abs(z) > 0.99 ? side : deck))];
  // Railings: posts and a top rail along each side (in unit space; the rise scales them).
  for (const s of [-1, 1]) {
    for (let i = 0; i <= 8; i++) {
      const u = (i / 8) * 2 - 1;
      const y = Math.sqrt(Math.max(1 - u * u, 0));
      parts.push(
        colored(new THREE.BoxGeometry(0.008, 0.2, 0.08), VERMILION, y + 0.1).translate(
          u,
          0,
          s * 0.95,
        ),
      );
    }
    const rail = new THREE.BoxGeometry(2, 0.03, 0.06, seg, 1, 1);
    const rp = rail.getAttribute('position');
    for (let k = 0; k < rp.count; k++) {
      const u = rp.getX(k);
      rp.setY(k, rp.getY(k) + Math.sqrt(Math.max(1 - u * u, 0)) + 0.19);
    }
    parts.push(colored(rail, VERMILION).translate(0, 0, s * 0.95));
  }
  // Piers at the quarter spans, down into the water.
  for (const u of [-0.55, 0.55])
    parts.push(
      colored(
        new THREE.BoxGeometry(0.06, 1.2, 1.7),
        '#6b5444',
        Math.sqrt(1 - u * u) - 0.7,
      ).translate(u, 0, 0),
    );
  return mergeGeometries(parts)!;
}

/** A stone lantern (~60 triangles, 2.3 m): base, post, the firebox (lit by night), a roof, a jewel. */
export function stoneLantern(): THREE.BufferGeometry {
  return mergeGeometries([
    colored(new THREE.CylinderGeometry(0.42, 0.5, 0.3, 6), STONE, 0.15),
    colored(new THREE.CylinderGeometry(0.16, 0.2, 0.9, 6), STONE, 0.75),
    colored(new THREE.CylinderGeometry(0.38, 0.3, 0.2, 6), STONE, 1.3),
    colored(new THREE.BoxGeometry(0.44, 0.42, 0.44), '#7d7a72', 1.61),
    colored(new THREE.ConeGeometry(0.62, 0.42, 6), '#8a877e', 2.02),
    colored(new THREE.SphereGeometry(0.12, 5, 3), STONE, 2.28),
  ])!;
}

/** Where a stone lantern's light sits (the firebox), local metres. */
export const STONE_LANTERN_LIGHT = { x: 0, y: 1.61, z: 0 };

/**
 * A thatched farmhouse (~120 triangles): dark timber walls on stones, white plaster panels, and
 * a tall, thick thatched roof, hipped, its ridge capped. Front faces +z. FARM_HEIGHT tall.
 */
export function farmhouseGeometry(): THREE.BufferGeometry {
  const W = 9;
  const D = 6.4;
  const parts = [
    colored(new THREE.BoxGeometry(W + 0.4, 0.4, D + 0.4), STONE, 0.2),
    colored(new THREE.BoxGeometry(W, 2.8, D), WOOD, 0.4 + 1.4),
    colored(new THREE.PlaneGeometry(2.6, 1.3), PLASTER).translate(-2.2, 2.1, D / 2 + 0.02),
    colored(new THREE.PlaneGeometry(1.6, 2.2), '#2f241d').translate(1.8, 1.5, D / 2 + 0.02),
  ];
  // The thatch: a hip roof (a four-sided pyramid stretched along the ridge), thick at the eaves.
  const roof = new THREE.CylinderGeometry(0.2, 1, 1, 4, 2).rotateY(Math.PI / 4);
  const rp = roof.getAttribute('position');
  for (let k = 0; k < rp.count; k++) {
    // Stretch along x only above the eaves: a ridge instead of a point.
    const top = rp.getY(k) > 0.4;
    if (top) rp.setX(k, rp.getX(k) * 3.4);
  }
  roof.scale((W + 2.2) / 2 / 0.72, 4.6, (D + 2.4) / 2 / 0.72);
  const straw = new THREE.Color('#a8875a');
  const dark = new THREE.Color('#6f5638');
  parts.push(
    painted(
      jitter(roof, 0.08, 5),
      (_x, y, _z, out) => out.copy(dark).lerp(straw, smoothstep(-2.3, 1.8, y)),
      3.2 + 2.3,
    ),
  );
  parts.push(colored(new THREE.BoxGeometry(W * 0.62, 0.5, 0.9), '#4a3d30', 7.6));
  return mergeGeometries(parts)!;
}

export const FARM_HEIGHT = 8;
/** Half the farmhouse's footprint diagonal (m): keeps houses apart and off the roads. */
export const FARM_REACH = 6.2;

export function farmhouseFarGeometry(): THREE.BufferGeometry {
  const roof = new THREE.CylinderGeometry(0.25, 1, 1, 4, 1).rotateY(Math.PI / 4);
  roof.scale(7.6, 4.6, 6.2).translate(0, 5.5, 0);
  return mergeGeometries([
    colored(new THREE.BoxGeometry(9, 3.2, 6.4), WOOD, 1.6),
    colored(roof, '#9a7b52'),
  ])!;
}

/**
 * The lake pavilion (~420 triangles): three storeys on the island, square, the lowest open
 * under dark eaves, the two above gilt from rail to eave, a pyramid roof and a bronze bird on
 * its tip. PAVILION.h tall, widest eave PAVILION.r. Front faces +z.
 */
export function pavilionGeometry(): THREE.BufferGeometry {
  const parts = [colored(new THREE.BoxGeometry(15, 0.8, 15), STONE, 0.4)];
  const storeys = [
    { r: 5.2, h: 3.8, wall: '#e9dfc8', post: WOOD, y: 0.8 },
    { r: 4.3, h: 3.1, wall: GILT, post: '#b88d34', y: 6.0 },
    { r: 3.1, h: 2.6, wall: '#e3b44a', post: '#b88d34', y: 10.3 },
  ];
  for (let k = 0; k < storeys.length; k++) {
    const s = storeys[k];
    parts.push(
      colored(new THREE.BoxGeometry(s.r * 2 - 0.3, s.h, s.r * 2 - 0.3), s.wall, s.y + s.h / 2),
    );
    // Posts at the corners and between, and a dark band of lattice under the eaves.
    for (const x of [-1, 0, 1])
      for (const z of [-1, 1]) {
        parts.push(
          colored(new THREE.BoxGeometry(0.4, s.h, 0.4), s.post, s.y + s.h / 2).translate(
            x * s.r,
            0,
            z * s.r,
          ),
        );
        if (x !== 0)
          parts.push(
            colored(new THREE.BoxGeometry(0.4, s.h, 0.4), s.post, s.y + s.h / 2).translate(
              z * s.r,
              0,
              x * s.r * 0.01,
            ),
          );
      }
    parts.push(
      colored(
        new THREE.BoxGeometry(s.r * 2 + 0.2, 0.5, s.r * 2 + 0.2),
        k ? '#8a6424' : '#3b2a22',
        s.y + s.h - 0.25,
      ),
    );
    // A balcony rail round the upper storeys.
    if (k > 0)
      parts.push(
        colored(new THREE.BoxGeometry(s.r * 2 + 1.2, 0.35, s.r * 2 + 1.2), '#a77f30', s.y + 0.9),
      );
    parts.push(
      squareEaves(s.r, s.r + 3.2 - k * 0.5, 1.25, 1.0, '#3d3a36').translate(0, s.y + s.h + 1.2, 0),
    );
  }
  parts.push(
    colored(new THREE.ConeGeometry(3.4, 2.6, 4).rotateY(Math.PI / 4), '#3d3a36', 14.4 + 1.3),
  );
  parts.push(colored(new THREE.ConeGeometry(0.32, 1.4, 5), GILT, PAVILION.h - 0.9));
  // A wooden deck reaching out over the water before it.
  parts.push(colored(new THREE.BoxGeometry(5, 0.3, 9), '#7a5a44', 0.5).translate(0, 0, 11));
  return mergeGeometries(parts)!;
}

/**
 * A floating lantern (~30 triangles): a little paper box on a wooden float, glowing within
 * (the paper is lit by the lantern material; this is the float and frame).
 */
export function floatGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    colored(new THREE.BoxGeometry(0.62, 0.12, 0.62), '#5b4130', 0.06),
    colored(new THREE.BoxGeometry(0.06, 0.5, 0.06), '#4a3426', 0.37).translate(0.26, 0, 0.26),
    colored(new THREE.BoxGeometry(0.06, 0.5, 0.06), '#4a3426', 0.37).translate(-0.26, 0, -0.26),
  ])!;
}

/** The lantern's paper (drawn in the glowing lantern material). */
export function paperGeometry(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(0.46, 0.46, 0.46).translate(0, 0.37, 0);
}

/** A grey heron standing in the shallows (~50 triangles). */
export function heronGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    colored(new THREE.SphereGeometry(0.32, 6, 4).scale(1, 0.8, 1.7), '#a9aeb2', 1.05),
    colored(
      new THREE.CylinderGeometry(0.05, 0.07, 0.55, 4).rotateX(-0.4),
      '#b8bcc0',
      1.45,
    ).translate(0, 0, 0.42),
    colored(new THREE.SphereGeometry(0.1, 5, 3), '#d8dade', 1.7).translate(0, 0, 0.55),
    colored(new THREE.ConeGeometry(0.035, 0.35, 4).rotateX(Math.PI / 2), '#c9a34a', 1.68).translate(
      0,
      0,
      0.8,
    ),
    colored(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 3), '#6d6a5e', 0.4).translate(0.08, 0, 0),
    colored(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 3), '#6d6a5e', 0.4).translate(-0.08, 0, 0),
  ])!;
}

/** A sika deer grazing (~70 triangles), faces +z. */
export function deerGeometry(): THREE.BufferGeometry {
  const coat = '#9a6a45';
  const parts = [
    colored(new THREE.SphereGeometry(0.42, 6, 4).scale(0.8, 0.8, 1.6), coat, 1.0),
    colored(new THREE.CylinderGeometry(0.1, 0.14, 0.6, 5).rotateX(0.9), coat, 0.9).translate(
      0,
      0,
      0.75,
    ),
    colored(new THREE.SphereGeometry(0.15, 5, 3).scale(0.8, 0.8, 1.3), coat, 0.62).translate(
      0,
      0,
      1.0,
    ),
    colored(new THREE.SphereGeometry(0.1, 4, 3), '#efe6d6', 1.05).translate(0, 0, -0.62),
  ];
  for (const x of [-0.18, 0.18])
    for (const z of [-0.45, 0.45])
      parts.push(
        colored(new THREE.CylinderGeometry(0.04, 0.035, 0.75, 4), '#7a5236', 0.38).translate(
          x,
          0,
          z,
        ),
      );
  return mergeGeometries(parts)!;
}

/** A farmer in a straw hat (~50 triangles). */
export function farmerGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    colored(new THREE.CylinderGeometry(0.18, 0.26, 1.05, 6), '#4c5a6e', 0.55),
    colored(new THREE.SphereGeometry(0.14, 6, 4), '#d6b48e', 1.25),
    colored(new THREE.ConeGeometry(0.42, 0.2, 8), '#cdb071', 1.42),
  ])!;
}

/** Mossy boulder (welded, soft-shaded): grey stone, moss on its back, red leaves caught on it. */
export function boulderGeometry(seed: number, detail: number): THREE.BufferGeometry {
  const g = jitter(new THREE.IcosahedronGeometry(1, detail), 0.3, seed).scale(1.1, 0.72, 0.95);
  const stone = new THREE.Color('#9c9a92');
  const dark = new THREE.Color('#6f6d66');
  const moss = new THREE.Color('#6d7f45');
  return painted(g, (_x, y, _z, c) =>
    c
      .copy(dark)
      .lerp(stone, smoothstep(-0.6, 0.3, y))
      .lerp(moss, smoothstep(0.3, 0.65, y)),
  );
}

/**
 * A crow (~30 triangles), 1 m across the wings, faces +z: a black body and tail, two wings
 * whose tips beat (aAnim weight: how far out along the wing). aAnim kind LIFE_CROW.
 */
export function crowGeometry(): THREE.BufferGeometry {
  const body = colored(new THREE.ConeGeometry(0.11, 0.55, 5).rotateX(Math.PI / 2), '#26232a', 0);
  const head = colored(new THREE.SphereGeometry(0.08, 5, 3), '#1d1b20', 0).translate(0, 0.02, 0.3);
  const tail = colored(new THREE.BoxGeometry(0.16, 0.02, 0.22), '#26232a', 0).translate(
    0,
    0,
    -0.33,
  );
  const wing = (side: number) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [
          0,
          0,
          0.12,
          side * 0.55,
          0.04,
          -0.02,
          0,
          0,
          -0.1,
          0,
          0,
          -0.1,
          side * 0.55,
          0.04,
          -0.02,
          0,
          0,
          0.12,
        ],
        3,
      ),
    );
    return colored(g, '#2c2930');
  };
  const parts = [body, head, tail, wing(1), wing(-1)].map((g) =>
    anim(g, LIFE_CROW, (x) => Math.min(1, Math.abs(x) / 0.55)),
  );
  return mergeGeometries(parts)!.scale(1.6, 1.6, 1.6);
}

/**
 * A flat wooden boat (~70 triangles), 4.6 m, faces +z, a figure in a straw hat standing at the
 * stern pushing a long pole (aAnim weight 1: the pole and arms swing about the hands). `kind`
 * picks the motion (a circle on the lake, or up and down a reach of river).
 */
export function boatGeometry(kind: number): THREE.BufferGeometry {
  const hull = new THREE.BoxGeometry(1.3, 0.45, 4.6, 1, 1, 4);
  const hp = hull.getAttribute('position');
  for (let i = 0; i < hp.count; i++) {
    // Taper the ends and lift them a little: a punt's squared, upswept bow and stern.
    const z = hp.getZ(i) / 2.3;
    hp.setX(i, hp.getX(i) * (1 - 0.25 * z * z));
    hp.setY(i, hp.getY(i) + 0.12 * z * z);
  }
  const fixed = [
    colored(hull, '#6a4a34', 0.22),
    colored(new THREE.BoxGeometry(1.0, 0.04, 3.6), '#8a6a4e', 0.43),
    colored(new THREE.CylinderGeometry(0.17, 0.24, 1.0, 6), '#4a5566', 0.95).translate(0, 0, -1.1),
    colored(new THREE.SphereGeometry(0.13, 5, 3), '#d6b48e', 1.58).translate(0, 0, -1.1),
    colored(new THREE.ConeGeometry(0.42, 0.22, 8), '#cdb071', 1.75).translate(0, 0, -1.1),
  ].map((g) => anim(g, kind, 0));
  // The pole: from the hands, raked back and down into the water behind.
  const pole = new THREE.CylinderGeometry(0.03, 0.03, 4.4, 4);
  // Top at the hands (forward, high), foot down in the water behind the stern.
  pole.rotateX(0.42).translate(0, -0.45, -1.85);
  const arm = new THREE.BoxGeometry(0.09, 0.09, 0.45).translate(0, 1.38, -0.95);
  const moving = [colored(pole, '#7b6247'), colored(arm, '#4a5566')].map((g) => anim(g, kind, 1));
  return mergeGeometries([...fixed, ...moving])!;
}

/** A bronze incense burner on its stone step (~40 triangles), before a temple hall. */
export function censerGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    colored(new THREE.BoxGeometry(1.6, 0.3, 1.6), STONE, 0.15),
    colored(new THREE.CylinderGeometry(0.55, 0.42, 0.6, 8), '#5f5a46', 0.6),
    colored(new THREE.CylinderGeometry(0.62, 0.55, 0.1, 8), '#6e6852', 0.92),
    colored(new THREE.ConeGeometry(0.5, 0.45, 8), '#5f5a46', 1.35),
  ])!;
}

/** Where the incense smoke rises from (local metres over the censer's foot). */
export const CENSER_SMOKE = { x: 0, y: 1.2, z: 0 };
/** Where a farmhouse's smoke leaves its roof (the vent under the ridge cap). */
export const FARM_SMOKE = { x: 1.2, y: 7.9, z: 0 };

const DARK_WOOD = '#3f2d23';
const MACHIYA_TILE = '#4b4f55';
const NOREN = '#2e4470';

/** Vertical slats across a front (the townhouse's lattice): n thin boxes over width w, height h. */
function lattice(w: number, h: number, n: number, y: number, z: number, hex: string) {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < n; k++)
    parts.push(
      colored(new THREE.BoxGeometry(0.07, h, 0.07), hex, y).translate(
        -w / 2 + (w * (k + 0.5)) / n,
        0,
        z,
      ),
    );
  return mergeGeometries(parts)!;
}

/** Townhouse frontage (x) and depth (z), and how tall the tallest is (m, at scale 1). */
export const MACHIYA = { w: 6.4, d: 9, h: 7.6 };

/**
 * A two-storey townhouse (~300 triangles), front +z on the street: dark wood below behind a
 * lattice of slats, an indigo shop curtain in the doorway, a little tiled pent roof over the
 * ground floor, a low white upper storey set back with a slatted window, and a grey tile
 * roof whose ridge runs along the street. MACHIYA.h tall.
 */
export function machiyaGeometry(): THREE.BufferGeometry {
  const { w: W, d: D } = MACHIYA;
  const f = D / 2;
  const parts = [
    colored(new THREE.BoxGeometry(W, 0.3, D), STONE, 0.15),
    colored(new THREE.BoxGeometry(W, 2.9, D), DARK_WOOD, 0.3 + 1.45),
    colored(new THREE.PlaneGeometry(W - 0.4, 2.3), '#6b5140').translate(0, 1.55, f + 0.02),
    lattice(W * 0.55, 2.2, 14, 1.55, f + 0.08, '#2e211a').translate(W * 0.2, 0, 0),
    colored(new THREE.PlaneGeometry(1.5, 1.1), NOREN).translate(-W * 0.3, 2.35, f + 0.1),
    // The pent roof over the ground floor's front.
    colored(new THREE.BoxGeometry(W + 0.2, 0.18, 1.3).rotateX(0.32), MACHIYA_TILE, 3.35).translate(
      0,
      0,
      f + 0.45,
    ),
    // The upper storey, low, set back, white plaster with its slatted window.
    colored(new THREE.BoxGeometry(W, 2.0, D - 1.2), '#e6ddca', 3.2 + 1.0).translate(0, 0, -0.6),
    colored(new THREE.PlaneGeometry(W * 0.5, 0.8), '#3a2b22').translate(0, 4.3, f - 1.18),
    lattice(W * 0.5, 0.8, 9, 4.3, f - 1.12, '#e6ddca'),
    eaveRoof(W / 2 + 0.35, D / 2 + 0.5, 1.9, 0.25, MACHIYA_TILE).translate(0, 5.2, -0.3),
  ];
  return mergeGeometries(parts)!;
}

/** A one-and-a-half storey shop (~220 triangles): open front under a wide shop curtain. */
export function shopGeometry(): THREE.BufferGeometry {
  const { w: W, d: D } = MACHIYA;
  const f = D / 2;
  const parts = [
    colored(new THREE.BoxGeometry(W, 0.3, D), STONE, 0.15),
    colored(new THREE.BoxGeometry(W, 3.4, D), DARK_WOOD, 0.3 + 1.7),
    colored(new THREE.PlaneGeometry(W - 0.6, 2.4), '#2a1f19').translate(0, 1.5, f + 0.02),
    colored(new THREE.PlaneGeometry(W - 0.8, 1.0), NOREN).translate(0, 2.25, f + 0.12),
    colored(new THREE.PlaneGeometry(0.5, 0.5), '#efe6d2').translate(0, 2.3, f + 0.14),
    lattice(W * 0.6, 0.7, 10, 3.25, f + 0.06, '#2e211a'),
    // Barrels by the door.
    colored(new THREE.CylinderGeometry(0.32, 0.32, 0.7, 7), '#8a6a44', 0.65).translate(
      W * 0.38,
      0,
      f + 0.6,
    ),
    colored(new THREE.CylinderGeometry(0.32, 0.32, 0.7, 7), '#7a5a3a', 0.65).translate(
      W * 0.25,
      0,
      f + 0.9,
    ),
    eaveRoof(W / 2 + 0.4, D / 2 + 0.7, 2.2, 0.3, MACHIYA_TILE).translate(0, 3.7, 0),
  ];
  return mergeGeometries(parts)!;
}

/** A tea house (~200 triangles): open on its street side, a red bench and a red parasol before it. */
export function teahouseGeometry(): THREE.BufferGeometry {
  const { w: W, d: D } = MACHIYA;
  const f = D / 2;
  const parts = [
    colored(new THREE.BoxGeometry(W, 0.3, D), STONE, 0.15),
    colored(new THREE.BoxGeometry(W, 3.0, D - 2), '#5a4130', 0.3 + 1.5).translate(0, 0, -1),
    colored(new THREE.PlaneGeometry(W - 1, 2.2), '#d9c9a4').translate(0, 1.5, f - 1.98),
    eaveRoof(W / 2 + 0.5, D / 2 + 0.6, 1.8, 0.4, '#5a4a3a').translate(0, 3.3, 0),
    // The red felt bench and the parasol over it.
    colored(new THREE.BoxGeometry(2.2, 0.12, 0.7), '#b8322a', 0.5).translate(-0.6, 0, f + 0.6),
    colored(new THREE.BoxGeometry(2.0, 0.45, 0.5), '#4a3426', 0.22).translate(-0.6, 0, f + 0.6),
    colored(new THREE.CylinderGeometry(0.03, 0.03, 2.6, 4), '#4a3426', 1.3).translate(
      1.3,
      0,
      f + 0.9,
    ),
    colored(new THREE.ConeGeometry(1.4, 0.55, 10, 1, true), '#c8362c', 2.6).translate(
      1.3,
      0,
      f + 0.9,
    ),
  ];
  return mergeGeometries(parts)!;
}

/** Far townhouse (~20 triangles): the mass and its gable roof. */
export function machiyaFarGeometry(): THREE.BufferGeometry {
  const { w: W, d: D } = MACHIYA;
  const roof = new THREE.CylinderGeometry(1, 1, 1, 3, 1).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2);
  roof.scale(W + 0.6, 1.9 / 1.5, (D + 1) / 0.87).translate(0, 5.1 + 0.5 * (1.9 / 1.5), 0);
  return mergeGeometries([
    colored(new THREE.BoxGeometry(W, 5.1, D), DARK_WOOD, 2.55),
    colored(roof, MACHIYA_TILE),
  ])!;
}

/**
 * A storehouse (~90 triangles): thick white plaster walls on a band of dark tiles, a small
 * iron-shuttered window, under a heavy grey tile roof. Front +z.
 */
export function kuraGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    colored(new THREE.BoxGeometry(4.6, 0.4, 5.6), STONE, 0.2),
    colored(new THREE.BoxGeometry(4.2, 1.1, 5.2), '#2f3236', 0.4 + 0.55),
    colored(new THREE.BoxGeometry(4.0, 3.2, 5.0), '#efe9dc', 1.5 + 1.6),
    colored(new THREE.PlaneGeometry(0.9, 0.9), '#2f3236').translate(0, 3.6, 2.52),
    colored(new THREE.PlaneGeometry(1.2, 1.9), '#3b3430').translate(0, 1.5, 2.62),
    eaveRoof(2.6, 3.2, 1.7, 0.3, MACHIYA_TILE)
      .translate(0, 4.7, 0)
      .rotateY(Math.PI / 2),
  ])!;
}

/**
 * A rice-drying rack (~50 triangles), 6 m: posts with a rail, sheaves of harvested rice hung
 * over it in a long golden curtain. Spans x.
 */
export function hasaGeometry(): THREE.BufferGeometry {
  const parts = [colored(new THREE.BoxGeometry(6.4, 0.08, 0.08), '#6d5a44', 2.3)];
  for (const x of [-3, 0, 3])
    parts.push(colored(new THREE.BoxGeometry(0.1, 2.5, 0.1), '#6d5a44', 1.25).translate(x, 0, 0));
  const straw = new THREE.BoxGeometry(6.0, 1.3, 0.55, 6, 1, 1);
  const sp = straw.getAttribute('position');
  // Sheaves hang heavier in the middle of each bay.
  for (let i = 0; i < sp.count; i++)
    if (sp.getY(i) < 0)
      sp.setY(i, sp.getY(i) - 0.25 * Math.abs(Math.sin((sp.getX(i) / 3) * Math.PI)));
  parts.push(colored(straw, '#c9a557', 1.65));
  return mergeGeometries(parts)!;
}

/**
 * A persimmon tree in late autumn (~170 triangles): its leaves nearly all fallen, bare grey
 * limbs hung with bright orange fruit, a few rust leaves left.
 */
export function persimmonGeometry(): THREE.BufferGeometry {
  const bark = '#5a5048';
  const parts = [colored(new THREE.CylinderGeometry(0.16, 0.26, 2.2, 5), bark, 1.1)];
  const limbs: [number, number, number, number][] = [
    [1.6, 2.0, 3.8, 0.4],
    [-1.4, 2.0, 3.9, -0.7],
    [0.3, 2.1, 4.4, 1.5],
    [-0.4, 2.1, 4.2, -1.6],
  ];
  for (const [x, y0, y1, z] of limbs) {
    const dir = new THREE.Vector3(x, y1 - y0, z);
    const g = new THREE.CylinderGeometry(0.05, 0.1, dir.length(), 4).translate(
      0,
      dir.length() / 2,
      0,
    );
    g.applyQuaternion(
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()),
    );
    parts.push(colored(g, bark, y0));
  }
  // Fruit along the limbs, and a few leaves.
  const rnd = (k: number) =>
    Math.sin(k * 12.9898) * 43758.5453 - Math.floor(Math.sin(k * 12.9898) * 43758.5453);
  for (let k = 0; k < 14; k++) {
    const [x, y0, y1, z] = limbs[k % 4];
    const t = 0.45 + 0.55 * rnd(k);
    parts.push(
      colored(new THREE.OctahedronGeometry(0.17), '#ef7a1e', y0 + (y1 - y0) * t - 0.15).translate(
        x * t + (rnd(k + 9) - 0.5) * 0.6,
        0,
        z * t + (rnd(k + 19) - 0.5) * 0.6,
      ),
    );
  }
  for (let k = 0; k < 4; k++)
    parts.push(
      colored(
        new THREE.OctahedronGeometry(0.45).scale(1, 0.4, 1),
        '#9c4a26',
        3.6 + rnd(k + 40) * 0.6,
      ).translate((rnd(k + 50) - 0.5) * 2.4, 0, (rnd(k + 60) - 0.5) * 2.4),
    );
  return mergeGeometries(parts)!;
}
