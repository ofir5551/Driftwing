import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { smoothstep } from '../../core/math';
import { colored, jitter, limb, lobe, painted, topLit } from '../Trees';
import { ARCH_LEG, ARCH_OUT_X, ARCH_OUT_Y } from './CanyonLayout';

/**
 * Red Canyons' shapes, built from primitives and painted with vertex colours. Arches and
 * hoodoos are unit shapes, scaled per instance; their rock is banded like the canyon walls.
 */

/** Sandstone layers from the foot up: deep red, rust, a pale band, orange, a cream cap. */
const BANDS = ['#8e3f27', '#b0532f', '#d9a070', '#c4683b', '#a54a2c', '#e6c597'].map(
  (h) => new THREE.Color(h),
);

/**
 * A unit arch: the band between two half ellipses (the opening 1 wide either side and 1 high,
 * the back ARCH_OUT_X by ARCH_OUT_Y), with legs running ARCH_LEG below the springing line, 1
 * deep along z. Scaled per instance by (half span, rise, depth), so it matches the layout's
 * collision shape. Lumpy, and banded in level strata.
 */
export function archGeometry(seed: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-ARCH_OUT_X, -ARCH_LEG);
  s.lineTo(-ARCH_OUT_X, 0);
  s.absellipse(0, 0, ARCH_OUT_X, ARCH_OUT_Y, Math.PI, 0, true, 0);
  s.lineTo(ARCH_OUT_X, -ARCH_LEG);
  s.lineTo(1, -ARCH_LEG);
  s.lineTo(1, 0);
  s.absellipse(0, 0, 1, 1, 0, Math.PI, false, 0);
  s.lineTo(-1, -ARCH_LEG);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: 1,
    steps: 2,
    curveSegments: 14,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.02,
    bevelSegments: 1,
  });
  g.translate(0, 0, -0.5);
  jitter(g, 0.035, Math.floor(seed * 1000) + 3);
  const c = new THREE.Color();
  return painted(g, (_x, y, z, out) => {
    // Level strata: the band follows height, wobbling a little across the fin.
    const k = Math.floor((y + ARCH_LEG + 0.04 * Math.sin(z * 9 + seed * 20)) * 4.2);
    out.copy(BANDS[((k % BANDS.length) + BANDS.length) % BANDS.length]);
    // The underside of the span and the legs' feet sit in shadow; the back catches the sky.
    out.multiplyScalar(0.82 + 0.22 * smoothstep(-ARCH_LEG, ARCH_OUT_Y, y));
    out.lerp(c.set('#f0d5aa'), smoothstep(ARCH_OUT_Y - 0.12, ARCH_OUT_Y, y) * 0.5);
  });
}

/**
 * A unit hoodoo (radius 1 at the foot, 1 tall): a lathed spire that waists in and swells in
 * bands of softer and harder rock, under a wider, darker cap stone. About 90 triangles.
 */
export function hoodooGeometry(slim: boolean): THREE.BufferGeometry {
  const w = slim ? 0.78 : 1;
  const prof: [number, number][] = [
    [1, 0],
    [0.72 * w, 0.14],
    [0.64 * w, 0.3],
    [0.48 * w, 0.48],
    [0.57 * w, 0.64],
    [0.42 * w, 0.8],
    [0.66, 0.86],
    [0.6, 0.95],
    [0, 1],
  ];
  const g = new THREE.LatheGeometry(
    prof.map(([r, y]) => new THREE.Vector2(r, y)),
    6,
  );
  jitter(g, 0.05, slim ? 11 : 12);
  const cap = new THREE.Color('#a0644a');
  return painted(g, (_x, y, _z, out) => {
    if (y > 0.83) {
      out.copy(cap);
      return;
    }
    const k = Math.max(0, Math.floor(y * 7));
    out.copy(BANDS[(k * 2 + 1) % BANDS.length]).lerp(BANDS[2], 0.25);
    out.multiplyScalar(0.85 + 0.2 * y);
  });
}

/** A twisted juniper: a grey crooked trunk under two dusky blue-green clumps (~50 triangles). */
export function juniperGeometry(): THREE.BufferGeometry {
  return topLit(
    mergeGeometries([
      colored(new THREE.CylinderGeometry(0.18, 0.32, 1.6, 4, 1, true), '#7a6a5c', 0.8),
      limb(0.7, 1.2, 2.2, 0.3, 0.16, '#7a6a5c'),
      lobe(1.3, 0.1, 2.3, -0.1, '#55704f', 41, 0.7),
      lobe(0.95, 0.9, 2.6, 0.4, '#617d58', 42, 0.75),
    ])!,
  );
}

/** A cottonwood by the river: a pale trunk under three bright, sunlit lobes (~70 triangles). */
export function cottonwoodGeometry(): THREE.BufferGeometry {
  return topLit(
    mergeGeometries([
      colored(new THREE.CylinderGeometry(0.3, 0.5, 4, 5, 1, true), '#a39684', 2),
      lobe(2.6, 0, 5.4, 0, '#8bab45', 51),
      lobe(1.9, 1.6, 4.6, 0.8, '#9cb850', 52),
      lobe(1.8, -1.4, 4.9, -0.7, '#7d9e3f', 53),
    ])!,
    0.7,
    1.15,
  );
}

/** Sagebrush: a low, silvery green-grey tuft (~20 triangles). */
export function sageGeometry(): THREE.BufferGeometry {
  return lobe(0.8, 0, 0.35, 0, '#a3ab8a', 61, 0.55);
}
