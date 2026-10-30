import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { gableGeometry } from '../city/geometry';
import { mulberry32 } from '../noise';
import { smoothstep } from '../../core/math';
import { colored, painted, topLit } from '../Trees';

/**
 * Aurora Fjords' shapes, in metres, built from primitives and painted with vertex colours.
 * Kept small: spruce number in the thousands.
 */

/** A snow-dusted spruce: a narrow dark cone with a white-tipped upper tier (~40 triangles). */
export function spruceGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    colored(new THREE.CylinderGeometry(0.22, 0.32, 2, 4, 1, true), '#5c4a44', 1),
    colored(new THREE.ConeGeometry(2.2, 6.5, 5), '#2f5a4e', 4.6),
    colored(new THREE.ConeGeometry(1.4, 4.4, 5), '#3d6a5c', 7.4),
    colored(new THREE.ConeGeometry(0.75, 2, 5), '#e8eef6', 9.2),
  ])!;
}

/**
 * Near spruce (~190 triangles): six narrow tiers with drooping, ragged skirts, each carrying
 * snow on its shoulders (white at the top of the tier, patchy round its middle, none on the dark
 * underside) so the tree reads as layered branches under a fresh fall.
 */
export function spruceDetailGeometry(): THREE.BufferGeometry {
  const parts = [colored(new THREE.CylinderGeometry(0.18, 0.34, 2.6, 5), '#54443e', 1.3)];
  const snow = new THREE.Color('#eef3f9');
  const tiers = 6;
  for (let i = 0; i < tiers; i++) {
    const u = i / (tiers - 1);
    const r = 2.4 - u * 1.75;
    const h = 2.6 - u * 0.8;
    const g = new THREE.ConeGeometry(r, h, 7, 2);
    const pos = g.getAttribute('position');
    for (let k = 0; k < pos.count; k++) {
      if (pos.getY(k) > -h / 2 + 0.01) continue;
      const a = Math.atan2(pos.getZ(k), pos.getX(k));
      const fray = 1 + 0.12 * Math.sin(a * 7 + i * 1.7);
      pos.setXYZ(k, pos.getX(k) * fray, pos.getY(k) - 0.4 * fray, pos.getZ(k) * fray);
    }
    g.rotateY(i * 0.9);
    const green = new THREE.Color(i % 2 ? '#34604f' : '#2e594a');
    const under = green.clone().offsetHSL(0, 0, -0.07);
    // The top tier is all snow cap; lower tiers hold it on their upper half in patches.
    const cover = i === tiers - 1 ? 1 : 0.55 + 0.1 * u;
    parts.push(
      painted(
        g,
        (x, y, z, out) => {
          const patch = 0.6 + 0.4 * Math.sin(Math.atan2(z, x) * 3 + i * 2.3);
          const s = smoothstep(-h * 0.1, h * 0.45, y) * cover * (y > h * 0.3 ? 1 : patch);
          out
            .copy(under)
            .lerp(green, smoothstep(-h / 2, 0, y))
            .lerp(snow, s);
        },
        2.6 + u * 6.4,
      ),
    );
  }
  return topLit(mergeGeometries(parts)!, 0.8, 1.06);
}

/**
 * A rorbu: a red fisherman's cabin on stilts at the water's edge, white trim and a turf-dark
 * gable roof, its door facing the water (+z). The windows are a separate mesh (they glow).
 */
export function hutGeometry(): THREE.BufferGeometry {
  const parts = [
    colored(new THREE.BoxGeometry(6, 4.2, 8), '#a8323a', 3.1),
    colored(
      gableGeometry()
        .scale(6.9, 2.6, 8.8)
        .rotateY(Math.PI / 2),
      '#3a3c44',
      5.2,
    ),
    colored(new THREE.BoxGeometry(6.2, 0.3, 8.2), '#efe9e2', 1),
    colored(new THREE.BoxGeometry(1.3, 2.4, 0.15), '#efe9e2', 2.2).translate(0, 0, 4.03),
    colored(new THREE.BoxGeometry(0.7, 1.6, 0.7), '#4a4a50', 7).translate(1.6, 0, -2),
  ];
  for (const x of [-2.6, 2.6])
    for (const z of [-3.6, 3.6])
      parts.push(colored(new THREE.BoxGeometry(0.4, 1.4, 0.4), '#4c3d36', 0.3).translate(x, 0, z));
  return mergeGeometries(parts)!;
}

/** The hut's windows: two on the water side, one on each gable end. */
export function hutWindowGeometry(): THREE.BufferGeometry {
  const g = (w: number, h: number, d: number, x: number, y: number, z: number) =>
    new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  return mergeGeometries([
    g(0.9, 0.9, 0.12, -1.9, 3.4, 4.04),
    g(0.9, 0.9, 0.12, 1.9, 3.4, 4.04),
    g(0.12, 0.9, 0.9, 3.04, 3.4, 0),
    g(0.12, 0.9, 0.9, -3.04, 3.4, 0),
  ])!;
}

/** A pan of sea ice: a flat, ragged white plate floating just proud of the water. */
export function floeGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1, 1, 0.5, 9);
  const p = g.getAttribute('position');
  // Ragged rim as a function of angle, so the cap and side vertices at a corner move together.
  for (let i = 0; i < p.count; i++) {
    const a = Math.atan2(p.getZ(i), p.getX(i));
    const s =
      0.8 + 0.18 * Math.sin(a * 2 + 1) + 0.12 * Math.sin(a * 5 + 2) + 0.08 * Math.sin(a * 7);
    p.setXYZ(i, p.getX(i) * s, p.getY(i), p.getZ(i) * s);
  }
  return colored(g, '#e3eef6', 0.1);
}

/**
 * An iceberg in unit radius and height: a jagged faceted lump, white above and a glacial
 * blue toward the waterline, sunk well below the surface so its foot never shows.
 */
export function bergGeometry(seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1); // already non-indexed: a vertex per face corner
  const rand = mulberry32(seed);
  const p = g.getAttribute('position');
  // Jitter each distinct corner the same way so the facets stay closed.
  const moved = new Map<string, [number, number, number]>();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let v = moved.get(k);
    if (!v) {
      const y = p.getY(i);
      const s = 0.8 + rand() * 0.35;
      // A flat-topped tabular berg or a peaked one, by seed.
      const top = seed % 2 ? Math.min(y, 0.55) : y * (1 + rand() * 0.5);
      v = [p.getX(i) * s, top, p.getZ(i) * s];
      moved.set(k, v);
    }
    p.setXYZ(i, v[0], v[1], v[2]);
  }
  g.translate(0, 0.15, 0);
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  const white = new THREE.Color('#f2f8fc');
  const blue = new THREE.Color('#7fc4d4');
  for (let i = 0; i < p.count; i += 3) {
    const y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
    c.copy(blue).lerp(white, THREE.MathUtils.smoothstep(y, -0.1, 0.5));
    for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (i + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

/** Lighthouse: a white tapering tower with red bands, a gallery, a dark lantern cap. */
export function lighthouseGeometry(h: number, r: number): THREE.BufferGeometry {
  const body = h - 4;
  const parts = [
    colored(new THREE.CylinderGeometry(r + 1.2, r + 1.6, 1.2, 10), '#8a8f96', 0.6),
    colored(new THREE.CylinderGeometry(r * 0.72, r, body, 12), '#f1efea', body / 2),
    colored(
      new THREE.CylinderGeometry(r * 0.75, r * 0.86, body * 0.14, 12),
      '#b23038',
      body * 0.62,
    ),
    colored(
      new THREE.CylinderGeometry(r * 0.88, r * 0.98, body * 0.14, 12),
      '#b23038',
      body * 0.24,
    ),
    colored(new THREE.CylinderGeometry(r * 1.05, r * 1.05, 0.4, 12), '#33363c', body + 0.2),
    colored(new THREE.ConeGeometry(r * 0.8, 1.8, 12), '#b23038', h - 0.9),
  ];
  return mergeGeometries(parts)!;
}

/** The lantern room's glass (glows after dark), on top of the tower. */
export function lampGeometry(h: number, r: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r * 0.6, r * 0.6, 2.1, 10).translate(0, h - 2.85, 0);
}

/**
 * The beam: a long, thin open cone with its apex at the origin pointing along +z, two of them
 * back to back as on a real optic. Drawn additively, so it reads as light in the sea smoke.
 */
export function beamGeometry(length: number, radius: number): THREE.BufferGeometry {
  const one = new THREE.ConeGeometry(radius, length, 12, 4, true)
    .translate(0, -length / 2, 0)
    .rotateX(-Math.PI / 2);
  // Brightest at the lamp, fading to nothing at the far end (black adds nothing).
  const p = one.getAttribute('position');
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++)
    col.fill(Math.pow(1 - p.getZ(i) / length, 1.6), i * 3, i * 3 + 3);
  one.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const two = one.clone().rotateY(Math.PI);
  return mergeGeometries([one, two])!;
}
