import * as THREE from 'three';
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

export function cylinderGeometry(): THREE.BufferGeometry {
  return flat(new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 1).translate(0, 0.5, 0));
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
