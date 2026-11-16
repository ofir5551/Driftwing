import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createNoise2D } from '../noise';
import { smoothstep } from '../../core/math';
import { colored, jitter, lobe, painted, topLit } from '../Trees';
import { smooth } from './shapes';

/**
 * Aurora Fjords' shapes, in metres, built from primitives and painted with vertex colours.
 * Kept small: spruce number in the thousands.
 */

/** A spruce: a narrow dark cone in two tiers with a frosted tip (~40 triangles). */
export function spruceGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    colored(new THREE.CylinderGeometry(0.22, 0.32, 2, 4, 1, true), '#5c4a44', 1),
    colored(new THREE.ConeGeometry(2.2, 6.5, 5), '#2b5242', 4.6),
    colored(new THREE.ConeGeometry(1.4, 4.4, 5), '#365f4c', 7.4),
    colored(new THREE.ConeGeometry(0.75, 2, 5), '#9fb5ae', 9.2),
  ])!;
}

/** A distant spruce (~6 triangles): one open dark cone, read as a dab in the haze. */
export function spruceDistantGeometry(): THREE.BufferGeometry {
  return topLit(colored(new THREE.ConeGeometry(1.9, 9.6, 6, 1, true), '#2e5544', 5.2), 0.7, 1.1);
}

/** Birch in autumn (far, ~50 tris): a slim white trunk under a tall gold crown. */
export function birchGeometry(): THREE.BufferGeometry {
  const crown = jitter(new THREE.IcosahedronGeometry(1.7, 0), 0.4, 61);
  crown.scale(0.85, 1.55, 0.85);
  return topLit(
    mergeGeometries([
      colored(new THREE.CylinderGeometry(0.16, 0.24, 5.2, 5), '#ece6dc', 2.6),
      colored(crown, '#c9a03c', 6.4),
    ])!,
    0.7,
    1.12,
  );
}

/** Near birch (~180 tris): a speckled trunk and a loose column of gold and amber lobes. */
export function birchNearGeometry(): THREE.BufferGeometry {
  const trunk = painted(
    new THREE.CylinderGeometry(0.15, 0.25, 6, 6, 4),
    (x, y, z, out) => out.set(Math.sin(y * 7 + x * 20 + z * 13) > 0.7 ? '#4b4446' : '#efe9df'),
    3,
  );
  const lobes: [number, number, number, number, string][] = [
    [1.3, 0, 5.4, 0, '#c29a3a'],
    [1.1, 0.7, 6.4, 0.3, '#d4ab45'],
    [1.1, -0.6, 6.6, -0.4, '#b98d34'],
    [1.0, 0.2, 7.6, -0.2, '#ddb850'],
    [0.9, -0.3, 8.4, 0.3, '#d9a840'],
    [0.9, 0.6, 5.0, -0.8, '#a98d3c'],
  ];
  const parts = [trunk];
  lobes.forEach(([r, x, y, z, hex], i) => parts.push(lobe(r, x, y, z, hex, 70 + i, 1.05)));
  return topLit(mergeGeometries(parts)!, 0.7, 1.12);
}

/** A distant birch (~8 triangles): a gold spindle, no trunk. */
export function birchDistantGeometry(): THREE.BufferGeometry {
  const g = new THREE.OctahedronGeometry(1.5, 0).scale(1, 2.3, 1);
  return topLit(colored(g, '#c49c3e', 5.8), 0.72, 1.1);
}

/**
 * Near spruce (~190 triangles): six narrow tiers with drooping, ragged skirts, frost on the
 * shoulders of the upper tiers, so the tree reads as layered branches.
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
    // A frost on the shoulders of the upper tiers (autumn: the snow is on the heights).
    const cover = i === tiers - 1 ? 0.6 : 0.12 * u;
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
 * A pan of sea ice (`sides` round its rim): a flat white plate with a ragged rim, its sides
 * tapering into the water and a pale blue band at the waterline. No bottom: it is never seen.
 */
export function floeGeometry(sides: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.92, 1, 0.5, sides, 1, false);
  const p = g.getAttribute('position');
  // Ragged rim as a function of angle, so the cap and side vertices at a corner move together.
  for (let i = 0; i < p.count; i++) {
    const a = Math.atan2(p.getZ(i), p.getX(i));
    const s =
      0.8 + 0.18 * Math.sin(a * 2 + 1) + 0.12 * Math.sin(a * 5 + 2) + 0.08 * Math.sin(a * 7);
    p.setXYZ(i, p.getX(i) * s, p.getY(i), p.getZ(i) * s);
  }
  // Drop the bottom cap's triangles (the last `sides` of the index).
  const idx = g.getIndex()!;
  g.setIndex(Array.from(idx.array).slice(0, idx.count - sides * 3));
  const top = new THREE.Color('#eef5fa');
  const side = new THREE.Color('#9fd0dc');
  return painted(
    g,
    (x, y, z, out) =>
      out
        .copy(side)
        .lerp(top, smoothstep(-0.2, 0.22, y))
        .multiplyScalar(0.96 + 0.05 * Math.sin(x * 3 + z * 2)),
    0.1,
  );
}

/**
 * An iceberg in unit radius and height (~320 tris, smooth): a sphere pushed out and in by a
 * smooth function of direction (so its lumps are rounded), a tabular berg's top cut flat with
 * a soft rounded edge, white above and glacial blue toward the waterline and in its hollows.
 */
export function bergGeometry(seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 3);
  const n = createNoise2D(seed * 101 + 7);
  const p = g.getAttribute('position');
  const v = new THREE.Vector3();
  const tabular = seed % 2 === 1;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const az = Math.atan2(v.z, v.x);
    const r =
      0.82 +
      0.16 * n(Math.cos(az) * 1.3 + v.y, Math.sin(az) * 1.3) +
      0.08 * n(v.x * 3, v.z * 3 + v.y * 2);
    let y = v.y * (tabular ? 1 : 1.25 + 0.2 * n(v.x * 2, v.z * 2));
    // A soft min against the table top: rounded over, not a knife edge.
    if (tabular) y = y - Math.log(1 + Math.exp((y - 0.5) * 12)) / 12;
    p.setXYZ(i, v.x * r, y, v.z * r);
  }
  g.translate(0, 0.15, 0);
  const white = new THREE.Color('#f2f8fc');
  const blue = new THREE.Color('#7fc4d4');
  const out = painted(g, (x, y, z, c) =>
    c.copy(blue).lerp(white, smoothstep(-0.05, 0.45, y + 0.12 * Math.sin(x * 5 + z * 4))),
  );
  return smooth(out);
}

/**
 * Lighthouse (smooth, 32 sides): a white tapering tower with two red bands on a stone base, a
 * gallery with a railing, a dark lantern cap and a red dome.
 */
export function lighthouseGeometry(h: number, r: number): THREE.BufferGeometry {
  const body = h - 4;
  const S = 32;
  const cyl = (rt: number, rb: number, hh: number, hex: string, y: number, open = false) =>
    colored(new THREE.CylinderGeometry(rt, rb, hh, S, 1, open), hex, y);
  const parts = [
    colored(new THREE.CylinderGeometry(r + 1.2, r + 1.6, 1.2, 12), '#8a8f96', 0.6),
    cyl(r * 0.72, r, body, '#f1efea', body / 2),
    cyl(r * 0.75, r * 0.86, body * 0.14, '#b23038', body * 0.62),
    cyl(r * 0.88, r * 0.98, body * 0.14, '#b23038', body * 0.24),
    cyl(r * 1.1, r * 1.1, 0.35, '#33363c', body + 0.15),
    cyl(r * 1.08, r * 1.08, 0.8, '#3b3f46', body + 0.75, true),
    colored(
      new THREE.SphereGeometry(r * 0.72, S, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      '#b23038',
      h - 1.6,
    ),
    colored(new THREE.BoxGeometry(1.1, 2.1, 0.3), '#3a2f2a', 2.2).translate(0, 0, r * 0.98),
  ];
  // Welded: smooth round the tower (its rims soften a little).
  return smooth(mergeGeometries(parts)!);
}

/** The lantern room's glass (glows after dark), on top of the tower. */
export function lampGeometry(h: number, r: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r * 0.6, r * 0.6, 2.1, 24).translate(0, h - 2.85, 0);
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
