import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { smoothstep } from '../../core/math';
import { mulberry32 } from '../noise';
import { colored, jitter, lobe, painted, topLit } from '../Trees';

/**
 * Jade River's village life and props, built in metres from primitives and painted with vertex
 * colours: houses and a hall under upturned eaves, a pagoda, a stone bridge (a unit shape the
 * instance stretches to its span), fishers' rafts and sampans, water buffalo, farmers in
 * conical hats, scree boulders and hanging vines. Most have a cheap far shape for the haze.
 */

const tmp = new THREE.Color();

/**
 * A geometry with smooth normals (from its index), painted per vertex, as a non-indexed copy
 * without uvs (so it merges with `colored` parts).
 */
function smooth(
  g: THREE.BufferGeometry,
  colorAt: (x: number, y: number, z: number, out: THREE.Color) => void,
): THREE.BufferGeometry {
  g.computeVertexNormals();
  const ng = g.index ? g.toNonIndexed() : g;
  const pos = ng.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    colorAt(pos.getX(i), pos.getY(i), pos.getZ(i), tmp);
    col[i * 3] = tmp.r;
    col[i * 3 + 1] = tmp.g;
    col[i * 3 + 2] = tmp.b;
  }
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  ng.deleteAttribute('uv');
  return ng;
}

/** A flat quad facing +z (or turned), for doors and windows set on a wall. */
function plate(w: number, h: number, hex: string): THREE.BufferGeometry {
  return colored(new THREE.PlaneGeometry(w, h), hex);
}

/**
 * A tiled roof with upturned eaves: a gable along x (ridge at height `h`, eaves at z = +-w,
 * ends at x = +-l). The slopes are swept (steep at the ridge, flattening at the eaves) and the
 * four corners curl up; a flat soffit closes it underneath. Top at y = h + the ridge's curl.
 */
export function eaveRoof(
  l: number,
  w: number,
  h: number,
  curl: number,
  hex: string,
  nx = 4,
  nz = 3,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const at = (u: number, v: number) => {
    // u in [-1, 1] along the ridge, v in [0, 1] from the ridge out to one eave.
    const lift = curl * Math.pow(Math.abs(u), 4);
    return h * Math.pow(1 - v, 1.6) + lift * (0.35 + v * v);
  };
  for (const side of [1, -1]) {
    const base = pos.length / 3;
    for (let j = 0; j <= nz; j++)
      for (let i = 0; i <= nx; i++) {
        const u = (i / nx) * 2 - 1;
        const v = j / nz;
        // The eave line swings out a little at the corners too.
        const flare = 1 + 0.06 * Math.pow(Math.abs(u), 4) * v;
        pos.push(u * l * (1 + 0.04 * v * v), at(u, v), side * v * w * flare);
      }
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const a = base + j * (nx + 1) + i;
        const b = a + 1;
        const c = a + nx + 1;
        const d = c + 1;
        if (side > 0) idx.push(a, c, b, b, c, d);
        else idx.push(a, b, c, b, d, c);
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const dark = new THREE.Color(hex);
  const light = new THREE.Color(hex).offsetHSL(0, -0.02, 0.07);
  const top = smooth(g, (_x, y, _z, out) => out.copy(dark).lerp(light, smoothstep(0, h, y)));
  const soffit = colored(
    new THREE.PlaneGeometry(l * 2, w * 2).rotateX(Math.PI / 2),
    '#3a3530',
    -0.05,
  );
  const ridge = colored(new THREE.BoxGeometry(l * 2.02, 0.32, 0.36), '#5c6266', h + 0.08);
  const parts = [top, soffit, ridge];
  // Ridge-end ornaments: little upswept horns.
  for (const s of [-1, 1])
    parts.push(
      colored(
        new THREE.ConeGeometry(0.16, 0.9, 4).rotateZ(-s * 0.9),
        '#5c6266',
        h + 0.35,
      ).translate(s * l * 1.02, 0, 0),
    );
  return mergeGeometries(parts)!;
}

/** Gable end of a wall: a triangle from (+-hw, 0) up to (0, h), facing +x at x = 0. */
function gableEnd(hw: number, h: number, hex: string): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [0, 0, hw, 0, 0, -hw, 0, h, 0, 0, 0, -hw, 0, 0, hw, 0, h, 0],
      3,
    ),
  );
  return colored(g, hex);
}

const WALL = '#ece6d6';
const PLINTH = '#8d8e86';
const TIMBER = '#6b4a36';
const TILE = '#4a5157';
const GLASS = '#3b4046';

/**
 * A village house (~130 triangles): whitewashed walls on a stone plinth, a timber band, a dark
 * door and shuttered windows, under a swept roof with upturned eaves. Two storeys add a timber
 * gallery. Front faces +z. Height: BUILT_HEIGHT (6.6 / 9.4 m at scale 1).
 */
export function houseGeometry(storeys: 1 | 2): THREE.BufferGeometry {
  const wall = storeys === 1 ? 3.4 : 6.2;
  const W = 7.6;
  const D = 5.6;
  const parts = [
    colored(new THREE.BoxGeometry(W + 0.4, 0.55, D + 0.4), PLINTH, 0.27),
    colored(new THREE.BoxGeometry(W, wall, D), WALL, 0.55 + wall / 2),
    colored(new THREE.BoxGeometry(W + 0.08, 0.28, D + 0.08), TIMBER, 0.55 + wall - 0.14),
    plate(1.3, 2.1, '#4b3a2e').translate(0, 0.55 + 1.05, D / 2 + 0.02),
  ];
  const top = 0.55 + wall;
  for (const s of [-1, 1]) {
    parts.push(
      gableEnd(D / 2, 1.9, WALL)
        .rotateY(s < 0 ? Math.PI : 0)
        .translate((s * W) / 2, top, 0),
    );
    for (let f = 0; f < storeys; f++) {
      const y = 0.55 + 1.9 + f * 2.9;
      parts.push(plate(1.1, 0.95, GLASS).translate(s * 2.4, y, D / 2 + 0.02));
      parts.push(
        plate(1.1, 0.95, GLASS)
          .rotateY(Math.PI)
          .translate(s * 2.2, y, -D / 2 - 0.02),
      );
    }
  }
  if (storeys === 2)
    parts.push(
      colored(new THREE.BoxGeometry(W + 0.5, 0.18, 1.0), TIMBER, 3.4).translate(0, 0, D / 2 + 0.5),
    );
  parts.push(eaveRoof(W / 2 + 0.9, D / 2 + 1.0, 2.1, 1.0, TILE).translate(0, top, 0));
  return mergeGeometries(parts)!;
}

/** The far house (~20 triangles): the same mass, a plain gable roof. */
export function houseFarGeometry(storeys: 1 | 2): THREE.BufferGeometry {
  const wall = storeys === 1 ? 3.4 : 6.2;
  // A triangular prism along x, apex up: the cylinder's three sides turned on their side.
  const roof = new THREE.CylinderGeometry(1, 1, 1, 3, 1).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2);
  roof.scale(9.4, 2.2 / 1.5, 4.4 / 0.87).translate(0, 0.55 + wall + 0.5 * (2.2 / 1.5), 0);
  return mergeGeometries([
    colored(new THREE.BoxGeometry(7.6, wall + 0.55, 5.6), WALL, (wall + 0.55) / 2),
    colored(roof, TILE),
  ])!;
}

/**
 * A village hall or temple (~260 triangles): a stone terrace, red columns along an open front
 * porch, and two tiers of upturned eaves. Height: BUILT_HEIGHT (10.4 m at scale 1).
 */
export function hallGeometry(): THREE.BufferGeometry {
  const W = 11;
  const D = 7.4;
  const parts = [
    colored(new THREE.BoxGeometry(W + 2.4, 0.9, D + 3.4), '#9a968c', 0.45),
    colored(new THREE.BoxGeometry(W, 4.2, D), '#e6dccb', 0.9 + 2.1),
    plate(2.2, 2.8, '#7a2f2a').translate(0, 0.9 + 1.4, D / 2 + 0.02),
  ];
  for (let k = 0; k < 6; k++)
    parts.push(
      colored(new THREE.CylinderGeometry(0.22, 0.24, 4.2, 6), '#a8433a', 0.9 + 2.1).translate(
        -W / 2 + 0.4 + (k * (W - 0.8)) / 5,
        0,
        D / 2 + 1.2,
      ),
    );
  parts.push(
    colored(new THREE.BoxGeometry(W + 0.4, 0.35, 0.35), '#8b3832', 4.95).translate(
      0,
      0,
      D / 2 + 1.2,
    ),
  );
  // Lower skirt of eaves, then the upper roof on a short clerestory.
  parts.push(eaveRoof(W / 2 + 1.4, D / 2 + 2.2, 1.5, 1.0, '#3f474c').translate(0, 5.1, 0));
  parts.push(colored(new THREE.BoxGeometry(W * 0.7, 1.5, D * 0.6), '#e6dccb', 6.4));
  parts.push(eaveRoof(W * 0.35 + 1.1, D * 0.3 + 1.5, 2.2, 1.0, '#3f474c').translate(0, 7.3, 0));
  parts.push(colored(new THREE.SphereGeometry(0.35, 6, 4), '#c9a64e', 9.9));
  return mergeGeometries(parts)!;
}

export function hallFarGeometry(): THREE.BufferGeometry {
  return houseFarGeometry(2).scale(1.4, 1.1, 1.4);
}

/**
 * A ring of eaves round a pagoda storey: flared out and down from the wall, its eight corners
 * curling up between straighter, lower runs.
 */
function eaveRing(r0: number, r1: number, drop: number, curl: number, hex: string) {
  const pos: number[] = [];
  const idx: number[] = [];
  const n = 16;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    // Even points are the corners; odd ones the middle of a run (a straight eave between).
    const corner = k % 2 === 0;
    const ro = corner ? r1 * 1.06 : r1 * Math.cos(Math.PI / 8);
    const lift = corner ? curl : 0;
    pos.push(
      c * r0,
      0,
      s * r0,
      c * ro,
      -drop + lift,
      s * ro,
      c * ro * 0.95,
      -drop + lift - 0.14,
      s * ro * 0.95,
    );
  }
  for (let k = 0; k < n; k++) {
    const a = k * 3;
    const b = ((k + 1) % n) * 3;
    idx.push(a, b, a + 1, b, b + 1, a + 1); // top
    idx.push(a + 1, b + 1, a + 2, b + 1, b + 2, a + 2); // rim, facing out and down
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const dark = new THREE.Color(hex);
  return painted(g, (_x, y, _z, out) => out.copy(dark).multiplyScalar(1 + 0.25 * (y + drop)));
}

/**
 * A seven-storey pagoda (~420 triangles) on an octagonal plinth: cream storeys narrowing upward,
 * a red band under each ring of dark, upturned eaves, a gilt finial. PAGODA_HEIGHT tall.
 */
export function pagodaGeometry(): THREE.BufferGeometry {
  const parts = [colored(new THREE.CylinderGeometry(5.2, 5.6, 0.9, 8), '#a8a296', 0.45)];
  const wall = new THREE.Color('#eee5cf');
  const band = new THREE.Color('#a8433a');
  let y = 0.9;
  for (let k = 0; k < 6; k++) {
    const r = 3.4 - k * 0.38;
    const h = k === 0 ? 2.8 : 1.8;
    // Cream walls with a red band under the eaves (painted, not built).
    const storey = new THREE.CylinderGeometry(r, r, h, 8, 2, true);
    parts.push(
      painted(storey, (_x, sy, _z, out) => out.copy(sy > h / 2 - 0.45 ? band : wall), y + h / 2),
    );
    y += h;
    parts.push(eaveRing(r - 0.1, r + 1.4 - k * 0.08, 0.6, 0.5, '#46504e').translate(0, y + 0.6, 0));
    y += 0.4;
  }
  parts.push(colored(new THREE.ConeGeometry(0.9, 1.2, 8), '#46504e', y + 0.6));
  parts.push(colored(new THREE.CylinderGeometry(0.08, 0.12, 2.6, 4), '#c9a64e', y + 2.3));
  parts.push(colored(new THREE.SphereGeometry(0.3, 6, 4), '#d7b75c', y + 1.6));
  return mergeGeometries(parts)!;
}

/** A hilltop pavilion: stone platform, red posts and beams, an upturned roof, a gilt finial. */
export function pavilionGeometry(): THREE.BufferGeometry {
  const parts = [
    colored(new THREE.CylinderGeometry(4.3, 4.8, 0.9, 8), '#a8a296', 0.45),
    eaveRoof(3.9, 3.9, 2.6, 1.1, '#3e4746').translate(0, 4.4, 0),
    colored(new THREE.ConeGeometry(0.32, 1.3, 6), '#c9a64e', 7.6),
  ];
  for (const x of [-2.6, 2.6])
    for (const z of [-2.6, 2.6])
      parts.push(
        colored(new THREE.CylinderGeometry(0.22, 0.24, 3.6, 6), '#ac4239', 2.7).translate(x, 0, z),
      );
  for (const z of [-2.6, 2.6]) {
    parts.push(colored(new THREE.BoxGeometry(5.6, 0.35, 0.3), '#8b3832', 4.35).translate(0, 0, z));
    parts.push(colored(new THREE.BoxGeometry(0.3, 0.35, 5.6), '#8b3832', 4.35).translate(z, 0, 0));
  }
  return mergeGeometries(parts)!;
}

/**
 * A multi-arch stone bridge as a unit shape: it spans local x from -1 to 1, its deck rising
 * from 0 at the ends to 1 at the crown (the layout's `deckY`), its width z from -1 to 1. The
 * instance scales it to the span, the hump and the width. Piers stand in the water; the end
 * abutments run down into the banks. Five or seven arches under the river's span.
 */
export function bridgeGeometry(arches: number): THREE.BufferGeometry {
  const deck = (u: number) => {
    const w = 1 - u * u;
    return w * (2 - w);
  };
  const shape = new THREE.Shape();
  const seg = 28;
  shape.moveTo(-1, -1.6);
  shape.lineTo(1, -1.6);
  for (let i = 0; i <= seg; i++) {
    const u = 1 - (i / seg) * 2;
    shape.lineTo(u, deck(u) - 0.04);
  }
  shape.closePath();
  const span = 0.7;
  const pitch = (span * 2) / arches;
  const aw = pitch * 0.38;
  for (let k = 0; k < arches; k++) {
    const u = -span + pitch * (k + 0.5);
    const crown = deck(u) - 0.3;
    // A round arch in metres on a typical bridge (45 m half span, 6 m hump): 7.5x taller here.
    const ry = Math.min(aw * 7.5, crown + 1.3);
    const cy = crown - ry;
    const hole = new THREE.Path();
    hole.moveTo(u - aw, -1.5);
    hole.lineTo(u + aw, -1.5);
    hole.lineTo(u + aw, cy);
    for (let i = 1; i < 8; i++) {
      const a = (i / 8) * Math.PI;
      hole.lineTo(u + Math.cos(a) * aw, cy + Math.sin(a) * ry);
    }
    hole.lineTo(u - aw, cy);
    hole.closePath();
    shape.holes.push(hole);
  }
  const body = new THREE.ExtrudeGeometry(shape, {
    depth: 1.7,
    bevelEnabled: false,
    curveSegments: 4,
  });
  body.translate(0, 0, -0.85);
  const stone = new THREE.Color('#aaa698');
  const wet = new THREE.Color('#6f7a6c');
  const parts = [
    painted(body, (_x, y, _z, out) => out.copy(wet).lerp(stone, smoothstep(-0.9, 0.1, y))),
  ];
  // Parapets along both edges of the deck.
  const rail = new THREE.Shape();
  rail.moveTo(-1, -0.02);
  for (let i = 0; i <= seg; i++) {
    const u = (i / seg) * 2 - 1;
    rail.lineTo(u, deck(u) + 0.2);
  }
  for (let i = seg; i >= 0; i--) {
    const u = (i / seg) * 2 - 1;
    rail.lineTo(u, deck(u) - 0.02);
  }
  rail.closePath();
  for (const z of [-1, 0.85]) {
    const r = new THREE.ExtrudeGeometry(rail, { depth: 0.15, bevelEnabled: false });
    parts.push(colored(r.translate(0, 0, z), '#b8b3a5'));
  }
  return mergeGeometries(parts)!;
}

/**
 * A cormorant fisher's bamboo raft (~150 triangles): seven poles lashed side by side, their
 * bows bent up; a figure in a straw hat leaning on a long pole, two cormorants on the
 * gunwale, a lantern post and a basket.
 */
export function raftGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const x = (i - 3) * 0.24;
    const hex = i % 2 ? '#c6ae78' : '#b39a64';
    parts.push(
      colored(
        new THREE.CylinderGeometry(0.11, 0.11, 6.4, 4, 1, true).rotateX(Math.PI / 2),
        hex,
        0.12,
      ).translate(x, 0, -0.6),
      colored(
        new THREE.CylinderGeometry(0.1, 0.11, 2.2, 4, 1, true).translate(0, 1.1, 0).rotateX(1.15),
        hex,
        0.12,
      ).translate(x, 0, 2.6),
    );
  }
  parts.push(
    colored(new THREE.BoxGeometry(1.75, 0.08, 0.16), '#7d6a48', 0.25).translate(0, 0, 1.6),
    colored(new THREE.BoxGeometry(1.75, 0.08, 0.16), '#7d6a48', 0.25).translate(0, 0, -2.8),
    colored(new THREE.CylinderGeometry(0.28, 0.4, 1.3, 6), '#39475a', 0.95).translate(0, 0, -0.8),
    colored(new THREE.IcosahedronGeometry(0.23, 0), '#d4b28c', 1.78).translate(0, 0, -0.8),
    colored(new THREE.ConeGeometry(0.78, 0.4, 8), '#dcc78f', 2.05).translate(0, 0, -0.8),
    colored(new THREE.CylinderGeometry(0.04, 0.05, 6, 4).rotateX(0.9), '#8a7350', 1.7).translate(
      0.45,
      0,
      1.1,
    ),
    colored(new THREE.CylinderGeometry(0.05, 0.05, 2.7, 4), '#6b5a44', 1.6).translate(0, 0, -3.7),
    colored(new THREE.CylinderGeometry(0.32, 0.25, 0.4, 6), '#9b8455', 0.45).translate(
      -0.45,
      0,
      -2.2,
    ),
  );
  for (const [x, z] of [
    [0.6, 1.9],
    [-0.6, 1.1],
  ]) {
    parts.push(
      colored(
        new THREE.IcosahedronGeometry(0.3, 0).scale(0.8, 0.9, 1.6),
        '#2d3233',
        0.55,
      ).translate(x, 0, z),
      colored(new THREE.CylinderGeometry(0.06, 0.09, 0.55, 4), '#2d3233', 0.9).translate(
        x,
        0,
        z + 0.35,
      ),
      colored(new THREE.ConeGeometry(0.06, 0.3, 3).rotateX(Math.PI / 2), '#c9a64e', 1.15).translate(
        x,
        0,
        z + 0.55,
      ),
    );
  }
  return mergeGeometries(parts)!;
}

export function raftFarGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    colored(new THREE.BoxGeometry(1.7, 0.3, 8), '#c6ae78', 0.12),
    colored(new THREE.CylinderGeometry(0.3, 0.4, 1.3, 4), '#39475a', 0.95).translate(0, 0, -0.8),
    colored(new THREE.ConeGeometry(0.78, 0.4, 5), '#dcc78f', 2.0).translate(0, 0, -0.8),
  ])!;
}

/**
 * A sampan (~90 triangles): a narrow wooden hull with raised ends under an arched bamboo awning,
 * moored off a village.
 */
export function sampanGeometry(): THREE.BufferGeometry {
  const hull = new THREE.BoxGeometry(1.6, 0.7, 7, 1, 1, 6);
  const p = hull.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i) / 3.5;
    const y = p.getY(i);
    // Taper to the ends, and lift them: a shallow banana.
    const taper = 1 - Math.pow(Math.abs(z), 3) * 0.75;
    p.setXYZ(i, p.getX(i) * taper * (y < 0 ? 0.7 : 1), y + z * z * 0.6, p.getZ(i));
  }
  // A half cylinder along z, arched over the top.
  const awning = new THREE.CylinderGeometry(
    0.85,
    0.85,
    2.8,
    7,
    1,
    true,
    Math.PI / 2,
    Math.PI,
  ).rotateX(Math.PI / 2);
  return mergeGeometries([
    painted(hull, (_x, y, _z, out) => out.set(y > 0.1 ? '#7a5a3c' : '#4c3a2b'), 0.2),
    colored(awning, '#9b8455', 0.75).translate(0, 0, -0.6),
    colored(new THREE.CylinderGeometry(0.04, 0.04, 1.3, 4), '#5c4a36', 1.0).translate(0, 0, -2.6),
  ])!;
}

/**
 * A water buffalo (~150 triangles): a heavy slate body with a hump over the shoulders, a low head
 * with great swept-back horns, sturdy legs. Faces +z; stands at y = 0.
 */
export function buffaloGeometry(): THREE.BufferGeometry {
  const hide = '#4a4f55';
  const body = jitter(new THREE.IcosahedronGeometry(1, 1), 0.12, 61).scale(0.75, 0.68, 1.35);
  const hump = new THREE.IcosahedronGeometry(0.55, 0).scale(1, 0.8, 1.1);
  const head = new THREE.IcosahedronGeometry(0.42, 0).scale(0.85, 0.85, 1.25);
  const parts = [
    smooth(smoothWeld(body), (_x, y, _z, out) =>
      out.set(hide).multiplyScalar(0.8 + 0.3 * smoothstep(-0.6, 0.6, y)),
    ).translate(0, 1.25, 0),
    colored(hump, '#53585e', 1.75).translate(0, 0, 0.55),
    colored(head, '#3f4449', 1.25).translate(0, 0, 1.75),
    colored(new THREE.BoxGeometry(0.4, 0.22, 0.25), '#2e3135', 1.08).translate(0, 0, 2.2),
  ];
  // Horns: arcs sweeping out and back from the brow.
  for (const s of [-1, 1]) {
    const horn = new THREE.TorusGeometry(0.42, 0.075, 3, 6, Math.PI * 0.9);
    horn.rotateX(Math.PI / 2).rotateY(s < 0 ? Math.PI : 0);
    parts.push(colored(horn, '#b9ad97', 1.55).translate(s * 0.4, 0, 1.6));
  }
  for (const [x, z] of [
    [-0.42, 0.85],
    [0.42, 0.85],
    [-0.4, -0.9],
    [0.4, -0.9],
  ])
    parts.push(
      colored(new THREE.CylinderGeometry(0.13, 0.11, 0.9, 4), '#3a3e43', 0.45).translate(x, 0, z),
    );
  parts.push(
    colored(new THREE.CylinderGeometry(0.03, 0.05, 0.9, 3).rotateX(0.3), '#3a3e43', 1.0).translate(
      0,
      0,
      -1.4,
    ),
  );
  return mergeGeometries(parts)!;
}

/**
 * A farmer (~70 triangles): bent over planting rice, a wide conical straw hat, indigo clothes.
 * Faces +z; stands at y = 0.
 */
export function farmerGeometry(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.2, 0.3, 0.95, 5).translate(0, 0.47, 0).rotateX(0.75);
  return mergeGeometries([
    colored(new THREE.CylinderGeometry(0.09, 0.08, 0.75, 4), '#2f3b52', 0.38).translate(
      -0.13,
      0,
      -0.1,
    ),
    colored(new THREE.CylinderGeometry(0.09, 0.08, 0.75, 4), '#2f3b52', 0.38).translate(
      0.13,
      0,
      -0.1,
    ),
    colored(body, '#3d4f6e', 0.72),
    colored(new THREE.IcosahedronGeometry(0.16, 0), '#c9a383', 1.3).translate(0, 0, 0.66),
    colored(new THREE.ConeGeometry(0.55, 0.32, 8), '#dcc78f', 1.47).translate(0, 0, 0.7),
    colored(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 3).rotateX(1.2), '#3d4f6e', 0.9).translate(
      0,
      0,
      0.75,
    ),
  ])!;
}

/** A mossy scree boulder: a lumpy, smooth-shaded stone, green where it faces the sky. */
export function boulderGeometry(seed: number, detail: number): THREE.BufferGeometry {
  const g = jitter(new THREE.IcosahedronGeometry(1, detail), 0.32, seed).scale(1.1, 0.75, 0.95);
  const stone = new THREE.Color('#9da39a');
  const dark = new THREE.Color('#6e776f');
  const moss = new THREE.Color('#5f8a4c');
  // Welded so the stone shades round, not faceted; mossy where it faces the sky.
  return smooth(smoothWeld(g), (_x, y, _z, c) =>
    c
      .copy(dark)
      .lerp(stone, smoothstep(-0.6, 0.3, y))
      .lerp(moss, smoothstep(0.25, 0.6, y)),
  );
}

/** Merge coincident vertices of a non-indexed shape so its normals average. */
function smoothWeld(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const map = new Map<string, number>();
  const verts: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const key = `${Math.round(pos.getX(i) * 1e3)},${Math.round(pos.getY(i) * 1e3)},${Math.round(pos.getZ(i) * 1e3)}`;
    let k = map.get(key);
    if (k === undefined) {
      k = verts.length / 3;
      map.set(key, k);
      verts.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    }
    idx.push(k);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  out.setIndex(idx);
  return out;
}

/**
 * A curtain of vines (~70 triangles near, ~16 far): leafy strands hanging from a clump on a
 * ledge, in the instance's own frame: local x across the wall (-0.5..0.5), y from the top (0)
 * down to the foot (-1), z out from the wall (metres; the strands bow out a little). Faces +z.
 */
export function vineGeometry(near: boolean): THREE.BufferGeometry {
  const rand = mulberry32(near ? 81 : 82);
  const strands = near ? 5 : 3;
  const segs = near ? 5 : 2;
  const pos: number[] = [];
  const col: number[] = [];
  const top = new THREE.Color('#4f7a3e');
  const tip = new THREE.Color('#86ad5c');
  for (let s = 0; s < strands; s++) {
    const x0 = (s / (strands - 1) - 0.5) * 0.8;
    const len = 0.55 + rand() * 0.45;
    const w = (near ? 0.09 : 0.14) * (0.8 + rand() * 0.4);
    let prevL: number[] | null = null;
    let prevR: number[] | null = null;
    let prevC: THREE.Color | null = null;
    for (let k = 0; k <= segs; k++) {
      const f = k / segs;
      const y = -f * len;
      const x = x0 + Math.sin(f * 5 + s) * 0.03;
      const z = 0.25 * Math.sin(Math.PI * f) + 0.05;
      // Leafy: the strand swells and pinches as it falls, and narrows to its tip.
      const ww = w * (1 - f * 0.6) * (k % 2 ? 1.35 : 0.8);
      const L = [x - ww, y, z];
      const R = [x + ww, y, z];
      const c = top.clone().lerp(tip, f);
      if (prevL && prevR && prevC) {
        pos.push(...prevL, ...L, ...prevR, ...prevR, ...L, ...R);
        for (const cc of [prevC, c, prevC, prevC, c, c]) col.push(cc.r, cc.g, cc.b);
      }
      prevL = L;
      prevR = R;
      prevC = c;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const nrm = new Float32Array(pos.length);
  for (let i = 2; i < nrm.length; i += 3) nrm[i] = 1; // lit like the wall they hang on
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  if (!near) return g;
  const clump = lobe(0.32, 0, 0, 0, '#5d8a45', 83, 0.6)
    .scale(1.4, 0.18, 0.9)
    .translate(0, 0.02, 0.2);
  return mergeGeometries([g, topLit(clump, 0.8, 1.1)])!;
}
