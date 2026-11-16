import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Config } from '../../core/Config';
import {
  cherryDetailGeometry,
  cherryGeometry,
  colored,
  pineDetailGeometry,
  pineGeometry,
  roundTreeDetailGeometry,
  roundTreeGeometry,
  topLit,
} from '../Trees';
import { CityLayout } from './CityLayout';

/**
 * Unit shapes for the city's instanced meshes. All sit on y = 0 with a 1 x 1 footprint
 * centred on the origin (the instance matrix scales them to size), and are non-indexed with
 * per-face normals for crisp low-poly facets.
 */

function fromTriangles(tris: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris), 3));
  g.computeVertexNormals();
  return g;
}

function flat(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  ng.deleteAttribute('uv');
  ng.computeVertexNormals();
  return ng;
}

export function boxGeometry(): THREE.BufferGeometry {
  return flat(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
}

/**
 * Pillars, lanterns and tanks: smooth-shaded round sides (the caps keep their own flat normals,
 * CylinderGeometry builds them as separate vertices), so a torii pillar reads round, not fluted.
 */
export function cylinderGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.5, 0.5, 1, Config.city.cylinderSegments, 1);
  g.deleteAttribute('uv');
  return g.translate(0, 0.5, 0);
}

/**
 * Soft shading for a merged, non-indexed shape: every vertex's normal leans (by `k`, 0..1) toward
 * the average of the faces that meet at its position. Lobes are jittered by position, so their
 * corners coincide and a crown shades as a smooth lumpy mass instead of cut facets; separate
 * lobes and the trunk share no corners, so their silhouettes stay distinct. Build time only.
 */
export function softShade(g: THREE.BufferGeometry, k: number): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const sum = new Map<string, [number, number, number]>();
  const key = (i: number) =>
    `${Math.round(pos.getX(i) * 1e3)},${Math.round(pos.getY(i) * 1e3)},${Math.round(pos.getZ(i) * 1e3)}`;
  for (let i = 0; i < pos.count; i++) {
    const kk = key(i);
    const acc = sum.get(kk) ?? [0, 0, 0];
    acc[0] += nrm.getX(i);
    acc[1] += nrm.getY(i);
    acc[2] += nrm.getZ(i);
    sum.set(kk, acc);
  }
  const v = new THREE.Vector3();
  const f = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const acc = sum.get(key(i))!;
    v.set(acc[0], acc[1], acc[2]).normalize();
    f.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    f.lerp(v, k).normalize();
    nrm.setXYZ(i, f.x, f.y, f.z);
  }
  nrm.needsUpdate = true;
  return g;
}

/** A distant tree: one soft crown on a three-sided trunk (~26 triangles), for beyond treeFar. */
function distantTree(
  crown: string,
  bark: string,
  r: number,
  y: number,
  squash: number,
  cone = false,
): THREE.BufferGeometry {
  const c = cone
    ? new THREE.ConeGeometry(r, y * 1.25, 6, 1).translate(0, y * 0.95, 0)
    : new THREE.IcosahedronGeometry(r, 0).scale(1, squash, 1).translate(0, y, 0);
  const g = topLit(
    mergeGeometries([
      colored(new THREE.CylinderGeometry(0.3, 0.45, y, 3, 1), bark, y / 2),
      colored(c, crown),
    ])!,
    0.7,
    1.1,
  );
  return softShade(g, 1);
}

/**
 * The city's trees (round street tree, pine, cherry) in three distances: the shared shapes with
 * soft normals (so a crown reads as a rounded mass, not a cut gem), near detail, and a one-crown
 * distant shape beyond render.treeFar.
 */
export function cityTreeShapes(): {
  far: THREE.BufferGeometry[];
  near: THREE.BufferGeometry[];
  distant: THREE.BufferGeometry[];
} {
  const k = Config.city.treeSoftness;
  return {
    far: [roundTreeGeometry(), pineGeometry(), cherryGeometry()].map((g) => softShade(g, k)),
    near: [roundTreeDetailGeometry(), pineDetailGeometry(), cherryDetailGeometry()].map((g) =>
      softShade(g, k),
    ),
    distant: [
      distantTree('#9cc970', '#8f6e5c', 3.1, 5.4, 0.9),
      distantTree('#5a9b78', '#8a6a5a', 2.7, 6.2, 1, true),
      distantTree('#f2b8c8', '#6d5058', 3.4, 4.8, 0.72),
    ],
  };
}

/** Tiled gable roof: a triangular prism with its ridge along x, plus a flat underside. */
export function gableGeometry(): THREE.BufferGeometry {
  const t: number[] = [];
  const q = (a: number[], b: number[], c: number[], d: number[]) =>
    t.push(...a, ...b, ...c, ...a, ...c, ...d);
  const L = [-0.5, 0, -0.5];
  const R = [0.5, 0, -0.5];
  const L2 = [-0.5, 0, 0.5];
  const R2 = [0.5, 0, 0.5];
  const TL = [-0.5, 1, 0];
  const TR = [0.5, 1, 0];
  q(L, TL, TR, R); // back slope
  q(R2, TR, TL, L2); // front slope
  t.push(...L2, ...TL, ...L); // gable ends
  t.push(...R, ...TR, ...R2);
  q(L, R, R2, L2); // underside
  return fromTriangles(t);
}

/**
 * Temple roof: concave hipped profile (steep at the top, flaring out flat at the eaves) with
 * the eave corners turned up. `ridge` is the fraction of the length that stays a ridge on top
 * (0 = a pagoda's square pyramid, ~0.35 = an irimoya-style hall roof).
 */
export function hipGeometry(ridge: number): THREE.BufferGeometry {
  const rings = 6;
  const pow = 1.8;
  // Eight vertices per ring: corners and side midpoints, so the corners can lift on their own.
  const ring = (i: number): number[][] => {
    const t = i / rings;
    const k = 1 - Math.pow(t, 1 / pow);
    const wz = 0.5 * k;
    const wx = ridge / 2 + (0.5 - ridge / 2) * k;
    const y = t;
    const lift = i === 0 ? 0.14 : i === 1 ? 0.04 : 0;
    return [
      [-wx, y + lift, -wz],
      [0, y, -wz],
      [wx, y + lift, -wz],
      [wx, y, 0],
      [wx, y + lift, wz],
      [0, y, wz],
      [-wx, y + lift, wz],
      [-wx, y, 0],
    ];
  };
  const t: number[] = [];
  for (let i = 0; i < rings; i++) {
    const a = ring(i);
    const b = ring(i + 1);
    for (let k = 0; k < 8; k++) {
      const k2 = (k + 1) % 8;
      t.push(...a[k], ...b[k], ...b[k2], ...a[k], ...b[k2], ...a[k2]);
    }
  }
  const r0 = ring(0);
  for (let k = 0; k < 8; k++) t.push(0, 0, 0, ...r0[k], ...r0[(k + 1) % 8]); // underside
  return fromTriangles(t);
}

/** Four-sided lattice tower shell, open at both ends; the shader cuts the lattice. */
export function latticeGeometry(): THREE.BufferGeometry {
  const rings = 24;
  const t: number[] = [];
  const corner = (i: number, k: number): number[] => {
    const v = i / rings;
    const w = CityLayout.latticeProfile(v) / 2;
    const sx = k === 0 || k === 3 ? -1 : 1;
    const sz = k < 2 ? -1 : 1;
    return [sx * w, v, sz * w];
  };
  for (let i = 0; i < rings; i++)
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      const a = corner(i, k);
      const b = corner(i + 1, k);
      const c = corner(i + 1, k2);
      const d = corner(i, k2);
      t.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  return fromTriangles(t);
}
