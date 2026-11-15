import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { smoothstep } from '../../core/math';
import { colored, jitter, limb, lobe, topLit } from '../Trees';
import { ARCH_LEG, ARCH_OUT_X, ARCH_OUT_Y } from './CanyonLayout';
import { BROW_RISE } from './CanyonSites';

/**
 * Red Canyons' rock and tree shapes. Rock (arches, hoodoos, a dwelling's brow, boulders) is
 * smooth-shaded and coloured by the rock shader's world strata (rock.ts), its vertex colours
 * only shading it; arches, hoodoos and brows are unit shapes scaled per instance to the
 * layout's collision shapes. Trees have a far shape and a soft, smooth-shaded near one.
 */

/** Signed power: a superellipse's rounded-box profile (e < 1 squares the corners off softly). */
const spow = (v: number, e: number) => Math.sign(v) * Math.abs(v) ** e;

/**
 * Vertex colours for an indexed (smooth-shaded) shape. Unlike Trees' `painted` it keeps the
 * index, so computeVertexNormals averages across faces: no facets. With the rock shader these
 * colours are a shade over the strata, so ~1 is plain rock.
 */
function shaded(
  g: THREE.BufferGeometry,
  shadeAt: (x: number, y: number, z: number, out: THREE.Color, i: number) => void,
): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    shadeAt(pos.getX(i), pos.getY(i), pos.getZ(i), c, i);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** An indexed grid of `rows` x `cols` points (`wrap`: the last column joins the first). */
function gridIndex(rows: number, cols: number, wrap: boolean): number[] {
  const idx: number[] = [];
  const cw = wrap ? cols : cols - 1;
  for (let r = 0; r < rows - 1; r++)
    for (let k = 0; k < cw; k++) {
      const a = r * cols + k;
      const b = r * cols + ((k + 1) % cols);
      idx.push(a, b, a + cols, b, b + cols, a + cols);
    }
  return idx;
}

/**
 * A smooth unit arch inside the layout's collision shape: the band between two half ellipses
 * (the opening 1 wide either side and 1 high, the back ARCH_OUT_X by ARCH_OUT_Y), legs running
 * ARCH_LEG below the springing line, 1 deep along z. Swept as a tube of rounded-box
 * cross-sections, `rings` along the band and `sides` round it, indexed so the normals are
 * smooth; slow, low lumps (not per-vertex jitter) weather it without crumpling the shading.
 * The rounded corners stay inside the solid's box, so what you see is what you hit.
 */
export function archGeometry(seed: number, rings: number, sides: number): THREE.BufferGeometry {
  const legRings = Math.max(3, Math.round(rings * 0.12));
  const spanRings = rings - 2 * legRings;
  // Inner and outer points of the band along its length: up the left leg, over, down the right.
  const path: [number, number, number, number][] = [];
  for (let i = 0; i < legRings; i++) {
    const y = -ARCH_LEG * (1 - i / legRings);
    path.push([-1, y, -ARCH_OUT_X, y]);
  }
  for (let i = 0; i <= spanRings; i++) {
    const th = Math.PI * (1 - i / spanRings);
    const c = Math.cos(th);
    const s = Math.sin(th);
    path.push([c, s, ARCH_OUT_X * c, ARCH_OUT_Y * s]);
  }
  for (let i = 1; i <= legRings; i++) {
    const y = -ARCH_LEG * (i / legRings);
    path.push([1, y, ARCH_OUT_X, y]);
  }
  const n = path.length;
  const P = new Float32Array(n * sides * 3);
  const ph = seed * 40;
  for (let r = 0; r < n; r++) {
    const [ix, iy, ox, oy] = path[r];
    const cx = (ix + ox) / 2;
    const cy = (iy + oy) / 2;
    // The feet flare a little into the scree they stand in (below the springing line, where
    // the solid's legs are as wide as its band, so this stays inside it).
    const foot = 1 + 0.15 * smoothstep(-0.15, -ARCH_LEG, cy);
    const ux = ((ox - ix) / 2) * foot;
    const uy = ((oy - iy) / 2) * foot;
    const t = r / (n - 1);
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      // Slow lumps, smooth along the band and round it, never out past the solid (<= 1).
      const lump =
        0.93 +
        0.05 * Math.sin(t * 23 + a * 2 + ph) * Math.sin(t * 9 - a + ph * 0.7) +
        0.02 * Math.sin(t * 61 + a * 3 + ph * 1.3);
      const rad = spow(Math.cos(a), 0.32) * lump;
      const dep = spow(Math.sin(a), 0.32) * (0.48 + 0.02 * Math.sin(t * 31 + ph));
      const j = (r * sides + k) * 3;
      P[j] = cx + ux * rad;
      P[j + 1] = cy + uy * rad;
      P[j + 2] = dep;
    }
  }
  const idx = gridIndex(n, sides, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setIndex(idx);
  // Face outward whichever way the rings wind: test one vertex's normal against its centre.
  g.computeVertexNormals();
  const nrm = g.getAttribute('normal');
  const r0 = Math.floor(n / 2);
  const v = r0 * sides;
  const cx = (path[r0][0] + path[r0][2]) / 2;
  const cy = (path[r0][1] + path[r0][3]) / 2;
  if ((P[v * 3] - cx) * nrm.getX(v) + (P[v * 3 + 1] - cy) * nrm.getY(v) < 0) {
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    g.setIndex(idx);
  }
  return shaded(g, (_x, y, _z, out) => {
    // The span's underside and the feet sit in shadow; the back catches the sky.
    const s = 0.84 + 0.22 * smoothstep(-ARCH_LEG, ARCH_OUT_Y, y);
    out.setScalar(s * (1 + 0.12 * smoothstep(ARCH_OUT_Y - 0.15, ARCH_OUT_Y, y)));
  });
}

/**
 * A smooth unit hoodoo (radius 1 at the foot, 1 tall): a spire that waists in and swells in
 * bands of softer and harder rock under a wider cap stone, the profile run through a spline,
 * `sides` round, welded so the normals are smooth, wobbled by slow lumps and leaning a little.
 * Slim hoodoos are this one narrowed per instance.
 */
export function hoodooGeometry(sides: number, rows: number): THREE.BufferGeometry {
  const prof: [number, number][] = [
    [1, 0],
    [0.74, 0.12],
    [0.62, 0.3],
    [0.47, 0.48],
    [0.57, 0.64],
    [0.42, 0.79],
    [0.68, 0.85],
    [0.6, 0.95],
    [0, 1],
  ];
  const curve = new THREE.SplineCurve(prof.map(([r, y]) => new THREE.Vector2(r, y)));
  const lathe = new THREE.LatheGeometry(curve.getPoints(rows), sides);
  lathe.deleteAttribute('uv');
  lathe.deleteAttribute('normal');
  const g = mergeVertices(lathe, 1e-4);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const a = Math.atan2(x, z);
    const f = 1 + 0.07 * Math.sin(a * 3 + 0.4 + y * 4) + 0.04 * Math.sin(a * 5 - 0.4 + y * 9);
    pos.setXYZ(i, x * f + 0.05 * y * y, y, z * f);
  }
  return shaded(g, (_x, y, _z, out) => {
    if (y > 0.82) {
      out.setRGB(0.74, 0.6, 0.56); // the darker, harder cap stone
      return;
    }
    // Softer and harder layers: alternate shades up the column under the world strata.
    const k = Math.floor(y * 7);
    out.setScalar((0.86 + 0.2 * y) * (k % 2 ? 0.92 : 1.04));
  });
}

/**
 * A cliff dwelling's brow, the unit shape behind CanyonSites' `browTop`: half a dome jutting
 * out of the cliff (+z, 1 out from its back at z = 0, 1 either side along x, BROW_RISE high
 * over its lip at y = 0), carried back into the rock, with a hollow under it whose ceiling
 * rises into the dark. Scaled per dwelling by (half width, reach, reach).
 */
export function browGeometry(): THREE.BufferGeometry {
  const A = 20; // round the half dome, from one end of the back line to the other
  const R = 9; // from the back line's middle out to the lip
  const back = 4; // rows carried back into the rock
  const cols = A + 1;
  const pts: number[] = [];
  const shade: number[] = [];
  // Outer surface: rows from the rock behind (z < 0) over the dome out to the lip ring.
  for (let r = -back; r <= R; r++)
    for (let k = 0; k <= A; k++) {
      const a = (k / A) * Math.PI;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      if (r <= 0) {
        const z = (r / back) * 0.6;
        pts.push(ca, BROW_RISE * sa ** 0.5 - z * 0.7, z * (0.3 + 0.7 * sa));
      } else {
        const rho = r / R;
        const lump = 1 + 0.04 * Math.sin(a * 5 + rho * 4) * rho;
        pts.push(
          ca * rho * lump,
          BROW_RISE * Math.sqrt(Math.max(0, 1 - rho * rho)) * sa ** 0.5,
          sa * rho * lump,
        );
      }
      shade.push(1);
    }
  const outerRows = R + back + 1;
  // Lip: a short band rolling under the rim.
  for (const [dr, dy, s] of [
    [1.0, -0.06, 0.85],
    [0.94, -0.1, 0.6],
  ] as const)
    for (let k = 0; k <= A; k++) {
      const a = (k / A) * Math.PI;
      pts.push(Math.cos(a) * dr, dy * Math.sin(a) ** 0.5, Math.sin(a) * dr);
      shade.push(s);
    }
  // The hollow's ceiling: from just inside the lip back and up into the dark.
  for (let r = R; r >= 0; r--)
    for (let k = 0; k <= A; k++) {
      const a = (k / A) * Math.PI;
      const rho = (r / R) * 0.92;
      const yy = -0.1 + 0.7 * BROW_RISE * Math.sqrt(Math.max(0, 1 - (rho / 0.92) ** 2));
      pts.push(Math.cos(a) * rho, yy * Math.sin(a) ** 0.5, Math.sin(a) * rho);
      shade.push(0.22 + 0.4 * (r / R) ** 2);
    }
  const rows = outerRows + 2 + R + 1;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const idx = gridIndex(rows, cols, false);
  // Rows run outward over the top, so wind each quad to face up and out.
  for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  g.setIndex(idx);
  return shaded(g, (_x, _y, _z, out, i) => out.setScalar(shade[i]));
}

/** A boulder fallen from the cliffs: a lumpy rock, smooth (near) or a 20-face cut (far). */
export function boulderGeometry(detail: number): THREE.BufferGeometry {
  const ico = new THREE.IcosahedronGeometry(1, detail);
  ico.deleteAttribute('normal');
  ico.deleteAttribute('uv');
  const g = jitter(mergeVertices(ico, 1e-4), 0.35, 71);
  g.scale(1, 0.62, 0.85);
  g.translate(0, 0.35, 0);
  return shaded(g, (_x, y, _z, out) => out.setScalar(0.8 + 0.25 * smoothstep(-0.3, 0.9, y)));
}

/**
 * A soft foliage lobe for the near trees: a once-subdivided icosahedron, welded, nudged into
 * lumps and smooth-shaded, so the toon bands wrap it as a rounded clump instead of showing its
 * 20 flat faces. Non-indexed on return (to merge with `colored` trunks) but keeps its normals.
 */
function softLobe(
  r: number,
  x: number,
  y: number,
  z: number,
  hex: string,
  seed: number,
  squash = 0.82,
  detail = 1,
): THREE.BufferGeometry {
  const ico = new THREE.IcosahedronGeometry(r, detail);
  ico.deleteAttribute('normal');
  ico.deleteAttribute('uv');
  const g = jitter(mergeVertices(ico, 1e-4), r * 0.22, seed);
  g.scale(1, squash, 1);
  g.computeVertexNormals();
  const ng = g.toNonIndexed();
  const pos = ng.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color(hex);
  const cool = new THREE.Color(hex).offsetHSL(0.03, 0.02, -0.08);
  const o = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    o.copy(cool).lerp(c, smoothstep(-r, r * 0.6, pos.getY(i)));
    col.set([o.r, o.g, o.b], i * 3);
  }
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return ng.translate(x, y, z);
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

/** Near juniper (~130 triangles): the crooked trunk under two soft blue-green clumps. */
export function juniperNearGeometry(): THREE.BufferGeometry {
  return topLit(
    mergeGeometries([
      colored(new THREE.CylinderGeometry(0.18, 0.32, 1.6, 6, 1, true), '#7a6a5c', 0.8),
      limb(0.7, 1.2, 2.2, 0.3, 0.16, '#7a6a5c'),
      softLobe(1.3, 0.1, 2.3, -0.1, '#55704f', 41, 0.7),
      softLobe(0.95, 0.9, 2.6, 0.4, '#617d58', 42, 0.75, 0),
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

/** Near cottonwood (~200 triangles): four soft, rounded lobes over the pale trunk and limbs. */
export function cottonwoodNearGeometry(): THREE.BufferGeometry {
  return topLit(
    mergeGeometries([
      colored(new THREE.CylinderGeometry(0.3, 0.5, 4, 7, 1, true), '#a39684', 2),
      limb(1.4, 3.2, 4.6, 0.6, 0.28, '#a39684'),
      limb(-1.3, 3.3, 4.8, -0.5, 0.26, '#a39684'),
      softLobe(2.5, 0, 5.6, 0, '#8bab45', 51),
      softLobe(1.9, 1.7, 4.7, 0.8, '#9cb850', 52, 0.82, 0),
      softLobe(1.8, -1.5, 5.0, -0.7, '#7d9e3f', 53, 0.82, 0),
      softLobe(1.4, 0.2, 6.7, -0.9, '#a3bf58', 54, 0.82, 0),
    ])!,
    0.7,
    1.15,
  );
}

/**
 * Coyote willow at the water's edge: a thicket of slender stems in narrow, silvery grey-green
 * plumes (far: three tall lobes, ~60 triangles).
 */
export function willowGeometry(): THREE.BufferGeometry {
  return topLit(
    mergeGeometries([
      lobe(0.9, 0, 1.6, 0, '#94a466', 81, 1.9),
      lobe(0.75, 0.8, 1.3, 0.3, '#a2b072', 82, 1.8),
      lobe(0.7, -0.6, 1.2, -0.5, '#8a9c5e', 83, 1.7),
    ])!,
    0.72,
    1.12,
  );
}

/** Near coyote willow (~140 triangles): the same thicket in soft plumes over a few stems. */
export function willowNearGeometry(): THREE.BufferGeometry {
  return topLit(
    mergeGeometries([
      limb(0.3, 0, 1.4, 0.1, 0.07, '#7d6b55'),
      limb(-0.4, 0, 1.2, -0.2, 0.06, '#7d6b55'),
      softLobe(0.9, 0, 1.7, 0, '#94a466', 81, 1.9),
      softLobe(0.75, 0.8, 1.4, 0.3, '#a2b072', 82, 1.8, 0),
      softLobe(0.7, -0.6, 1.3, -0.5, '#8a9c5e', 83, 1.7, 0),
    ])!,
    0.72,
    1.12,
  );
}

/** Sagebrush: a low, silvery green-grey mound, smooth-shaded (~40 triangles). */
export function sageGeometry(): THREE.BufferGeometry {
  return topLit(
    mergeGeometries([
      softLobe(0.8, 0, 0.35, 0, '#a3ab8a', 61, 0.55, 0),
      softLobe(0.55, 0.55, 0.3, 0.2, '#99a283', 62, 0.6, 0),
    ])!,
    0.75,
    1.1,
  );
}
