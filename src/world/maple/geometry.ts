import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { smoothstep } from '../../core/math';
import { colored, limb, lobe, painted, topLit } from '../Trees';
import { soften } from '../karst/geometry';

/**
 * Maple Valley's trees, built from primitives and painted per vertex: Japanese maples in
 * crimson, flame and the yellow-green of a tree still turning (a broad crown of flattened,
 * layered lobes on a forked trunk), golden ginkgos (a taller, rounder crown) and dark cedars
 * (tall, narrow tiers on a red trunk). Each has a near shape, a far shape and a distant one.
 * All are smooth-shaded (`soften`), so the toon bands wrap the lobes like brush strokes.
 */

/** A maple's palette: shaded lobe, mid, lit, top highlight. */
export interface Foliage {
  lobes: readonly string[];
  top: string;
}

export const CRIMSON: Foliage = { lobes: ['#b22f2a', '#c63a2d', '#d24a30'], top: '#e0663a' };
export const FLAME: Foliage = { lobes: ['#d1561f', '#e07527', '#e99232'], top: '#f2b04a' };
export const TURNING: Foliage = { lobes: ['#9c9a3a', '#b4a63c', '#c9b043'], top: '#dcc257' };
export const GINKGO: Foliage = { lobes: ['#dba52c', '#e9b935', '#f2ca45'], top: '#f8dc6a' };

const BARK = '#5b4136';

/**
 * Near maple (~130 triangles): a forked trunk under a wide crown of flattened lobes in two
 * layers, the lower spreading wide (the maple's tiered, parasol habit), the upper smaller.
 */
export function mapleDetailGeometry(f: Foliage): THREE.BufferGeometry {
  const L = f.lobes;
  const parts = [
    colored(new THREE.CylinderGeometry(0.28, 0.45, 3.2, 6, 1, true), BARK, 1.6),
    limb(1.6, 2.6, 4.2, 0.5, 0.26, BARK),
    limb(-1.4, 2.8, 4.4, -0.7, 0.24, BARK),
  ];
  const lobes: [number, number, number, number, string][] = [
    [2.5, 0.3, 4.5, 0.2, L[1]],
    [2.1, 2.2, 4.2, -0.6, L[0]],
    [2.1, -2.0, 4.3, 0.9, L[1]],
    [2.0, -0.5, 4.2, -2.0, L[2]],
    [1.7, 0.2, 6.0, 0.1, f.top],
  ];
  lobes.forEach(([r, x, y, z, hex], i) => parts.push(lobe(r, x, y, z, hex, 70 + i, 0.62)));
  return soften(topLit(mergeGeometries(parts)!, 0.62, 1.15));
}

/** Far maple (~70 triangles): a wide flattened crown and a cap on a short trunk. */
export function mapleGeometry(f: Foliage): THREE.BufferGeometry {
  const crown = new THREE.IcosahedronGeometry(3, 0).scale(1.2, 0.62, 1.2);
  const cap = new THREE.IcosahedronGeometry(1.9, 0).scale(1, 0.75, 1).translate(0.4, 1.3, -0.2);
  return soften(
    topLit(
      mergeGeometries([
        colored(new THREE.CylinderGeometry(0.3, 0.45, 3.4, 5), BARK, 1.7),
        colored(crown, f.lobes[1], 4.6),
        colored(cap, f.top, 4.6),
      ])!,
      0.64,
      1.12,
    ),
  );
}

/** Distant maple (20 triangles): one flattened ball. */
export function mapleDistantGeometry(f: Foliage): THREE.BufferGeometry {
  return topLit(
    colored(new THREE.IcosahedronGeometry(3.1, 0).scale(1.15, 0.7, 1.15), f.lobes[1], 4.8),
    0.7,
    1.1,
  );
}

/** Near ginkgo: a tall, round crown of lobes, golden all through. */
export function ginkgoDetailGeometry(): THREE.BufferGeometry {
  const L = GINKGO.lobes;
  const parts = [
    colored(new THREE.CylinderGeometry(0.3, 0.5, 5, 6), '#6a5446', 2.5),
    limb(1.0, 3.5, 6.0, 0.4, 0.24, '#6a5446'),
    limb(-0.9, 4.0, 6.6, -0.5, 0.22, '#6a5446'),
  ];
  const lobes: [number, number, number, number, string][] = [
    [2.2, 0, 5.6, 0, L[0]],
    [1.8, 1.4, 6.4, 0.5, L[1]],
    [1.8, -1.3, 6.6, -0.6, L[1]],
    [1.9, 0.2, 7.9, 0.1, L[2]],
    [1.5, -0.4, 9.3, 0.3, GINKGO.top],
    [1.2, 0.7, 8.9, -0.8, GINKGO.top],
  ];
  lobes.forEach(([r, x, y, z, hex], i) => parts.push(lobe(r, x, y, z, hex, 90 + i, 0.95)));
  return soften(topLit(mergeGeometries(parts)!, 0.66, 1.14));
}

export function ginkgoGeometry(): THREE.BufferGeometry {
  const crown = new THREE.IcosahedronGeometry(2.6, 0).scale(1, 1.45, 1);
  return soften(
    topLit(
      mergeGeometries([
        colored(new THREE.CylinderGeometry(0.3, 0.5, 4.6, 5), '#6a5446', 2.3),
        colored(crown, GINKGO.lobes[1], 7.2),
      ])!,
      0.66,
      1.12,
    ),
  );
}

export function ginkgoDistantGeometry(): THREE.BufferGeometry {
  return topLit(
    colored(new THREE.IcosahedronGeometry(2.6, 0).scale(1, 1.4, 1), GINKGO.lobes[1], 7),
    0.7,
    1.1,
  );
}

/**
 * Near cedar (~100 triangles): a tall red trunk and six narrow, drooping tiers of dark green,
 * each darker underneath: the sugi of a temple grove.
 */
export function cedarDetailGeometry(): THREE.BufferGeometry {
  const parts = [colored(new THREE.CylinderGeometry(0.25, 0.48, 5, 6), '#7a4a38', 2.5)];
  const hues = ['#34513d', '#3a5942', '#405f46', '#47674b', '#4f7050', '#587955'];
  const tiers = hues.length;
  for (let i = 0; i < tiers; i++) {
    const u = i / (tiers - 1);
    const r = 2.0 - u * 1.35;
    const h = 2.6 - u * 0.6;
    const g = new THREE.ConeGeometry(r, h, 7, 1);
    g.rotateY(i * 0.9);
    const base = new THREE.Color(hues[i]);
    const under = base.clone().offsetHSL(0.01, 0, -0.1);
    parts.push(
      painted(
        g,
        (_x, y, _z, out) => out.copy(under).lerp(base, smoothstep(-h / 2, h / 3, y)),
        3.6 + u * 8.6,
      ),
    );
  }
  return soften(topLit(mergeGeometries(parts)!, 0.74, 1.08));
}

export function cedarGeometry(): THREE.BufferGeometry {
  return soften(
    topLit(
      mergeGeometries([
        colored(new THREE.CylinderGeometry(0.26, 0.45, 4, 5), '#7a4a38', 2),
        colored(new THREE.ConeGeometry(2.1, 6, 6), '#3a5942', 6),
        colored(new THREE.ConeGeometry(1.4, 5, 6), '#47674b', 9.6),
      ])!,
      0.74,
      1.08,
    ),
  );
}

export function cedarDistantGeometry(): THREE.BufferGeometry {
  return topLit(colored(new THREE.ConeGeometry(2, 11, 5), '#3d5c44', 7.5), 0.75, 1.08);
}
