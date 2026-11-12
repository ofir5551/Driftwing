import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { smoothstep } from '../../core/math';
import { hipGeometry } from '../city/geometry';
import { mulberry32 } from '../noise';
import { colored, topLit } from '../Trees';
import { rockProfile, type RockShape } from './AtollLayout';

/**
 * Coral Atolls' shapes. Mushroom rocks are lathed from the layout's profile in cap radii
 * (radius 1, height in metres; the instance scales them), so collisions match the drawn rock.
 * Everything else is built in metres from primitives and painted with vertex colours.
 */

const FROND = new THREE.Color('#4f9a45');
const FROND_TIP = new THREE.Color('#a6c95a');
const FROND_DARK = new THREE.Color('#2f6b3a');

/**
 * One palm frond along +x from the origin: a midrib that lifts, then arches over and droops,
 * with leaflets folded down either side of it in a shallow V. Both windings, so it reads from
 * above and below. Dark at the heart of the crown, sunlit yellow-green toward the tip.
 */
function frond(len: number, width: number, segs: number, droop: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const rib: number[][] = [];
  const edge: number[] = [];
  for (let k = 0; k <= segs; k++) {
    const u = k / segs;
    rib.push([len * u, len * 0.28 * Math.sin(u * Math.PI * 0.55) - droop * u * u, 0]);
    edge.push(width * Math.sin(Math.PI * Math.min(0.15 + u * 0.95, 1)) * (1 - u * 0.55));
  }
  const c = new THREE.Color();
  const push = (p: number[], u: number) => {
    pos.push(p[0], p[1], p[2]);
    c.copy(FROND_DARK)
      .lerp(FROND, smoothstep(0, 0.35, u))
      .lerp(FROND_TIP, smoothstep(0.5, 1, u));
    col.push(c.r, c.g, c.b);
  };
  for (let k = 0; k < segs; k++) {
    const a = rib[k];
    const b = rib[k + 1];
    for (const side of [1, -1]) {
      const ea = [a[0] + 0.15, a[1] - edge[k] * 0.35, edge[k] * side];
      const eb = [b[0] + 0.15, b[1] - edge[k + 1] * 0.35, edge[k + 1] * side];
      const u0 = k / segs;
      const u1 = (k + 1) / segs;
      // Front and back faces.
      for (const flip of [false, true]) {
        const back = flip !== side < 0;
        const tri = back ? [a, eb, ea, a, b, eb] : [a, ea, eb, a, eb, b];
        const us = back ? [u0, u1, u0, u0, u1, u1] : [u0, u0, u1, u0, u1, u1];
        tri.forEach((p, i) => push(p, us[i]));
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** A palm's curving trunk: stacked tapering segments leaning further out as they rise. */
function trunk(
  h: number,
  lean: number,
  segs: number,
  sides: number,
): {
  parts: THREE.BufferGeometry[];
  top: THREE.Vector3;
} {
  const parts: THREE.BufferGeometry[] = [];
  let x = 0;
  let y = 0;
  for (let k = 0; k < segs; k++) {
    const u0 = k / segs;
    const u1 = (k + 1) / segs;
    // The lean grows with the square of the height: upright at the foot, curving out above.
    const x1 = lean * u1 * u1;
    const y1 = h * u1;
    const dir = new THREE.Vector3(x1 - x, y1 - y, 0);
    const r0 = 0.32 - 0.12 * u0;
    const r1 = 0.32 - 0.12 * u1;
    const g = new THREE.CylinderGeometry(r1, r0, dir.length(), sides, 1, true).translate(
      0,
      dir.length() / 2,
      0,
    );
    g.applyQuaternion(
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()),
    );
    g.translate(x, y, 0);
    // Ringed bark: alternate bands a shade apart.
    parts.push(colored(g, k % 2 ? '#a08a6a' : '#8d7759'));
    x = x1;
    y = y1;
  }
  return { parts, top: new THREE.Vector3(x, y, 0) };
}

/** Far coconut palm (~60 triangles): a leaning trunk under six broad, drooping fronds. */
export function palmGeometry(): THREE.BufferGeometry {
  const { parts, top } = trunk(10.5, 2.2, 2, 3);
  // Broader than the near fronds: far away a thin frond vanishes and the palm reads as a stick.
  for (let k = 0; k < 6; k++) {
    const f = frond(5, 1.6, 1, 1.4).rotateZ(k % 2 ? 0.15 : -0.1);
    parts.push(f.rotateY((k / 6) * Math.PI * 2 + 0.3).translate(top.x, top.y, top.z));
  }
  return mergeGeometries(parts)!;
}

/**
 * Near coconut palm (~200 triangles): a ringed trunk curving out of the sand under a full
 * crown of eight arching fronds (a few young ones standing up, the old ones hanging low) and
 * a cluster of coconuts.
 */
export function palmDetailGeometry(): THREE.BufferGeometry {
  const rand = mulberry32(31);
  const { parts, top } = trunk(10.5, 2.2, 4, 5);
  for (let k = 0; k < 8; k++) {
    const young = k % 3 === 0;
    const f = frond(4.4 + rand() * 1.2, 1.25, 3, young ? 0.6 : 2.2 + rand() * 0.8);
    f.rotateZ(young ? 0.35 : -0.05 + rand() * 0.1);
    f.rotateY((k / 8) * Math.PI * 2 + rand() * 0.4);
    parts.push(f.translate(top.x, top.y, top.z));
  }
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    parts.push(
      colored(new THREE.TetrahedronGeometry(0.32, 1), '#6f5a32').translate(
        top.x + Math.cos(a) * 0.4,
        top.y - 0.5,
        Math.sin(a) * 0.4,
      ),
    );
  }
  return mergeGeometries(parts)!;
}

/** A low beach shrub (naupaka, pandanus) to fill the islets between the palms. */
export function shrubGeometry(): THREE.BufferGeometry {
  const a = new THREE.IcosahedronGeometry(1.6, 0).scale(1.3, 0.7, 1.1);
  const b = new THREE.IcosahedronGeometry(1.1, 0).translate(1.3, 0.3, 0.4);
  return topLit(
    mergeGeometries([colored(a, '#5c9a4a', 0.8), colored(b, '#73ab52', 0.8)])!,
    0.7,
    1.12,
  );
}

const STONE = new THREE.Color('#d3d0c2');
const STONE_DARK = new THREE.Color('#8e8f86');
const NOTCH = new THREE.Color('#5f5a4c');
const WET = new THREE.Color('#6e7a6c');
const JUNGLE = new THREE.Color('#3f8a46');
const JUNGLE_LIGHT = new THREE.Color('#69ac4f');

/**
 * One mushroom rock: pale limestone worn into a dark notch at the waterline (wet and green
 * below it), swelling to an overhanging cap under a lumpy dome of jungle. Smooth-shaded so the
 * toon bands sweep round it.
 */
export function rockGeometry(
  sh: RockShape,
  seed: number,
  SEG = 14,
  RINGS = 16,
): THREE.BufferGeometry {
  const rand = mulberry32(seed);
  const ph = rand() * 10;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Color();
  const g = new THREE.Color();
  const tw = 9 / sh.H;
  for (let i = 0; i <= RINGS; i++) {
    // Rings bunch round the notch and over the dome, where the profile bends.
    const u = i / RINGS;
    const t =
      u < 0.5 ? tw * 1.6 * (u / 0.5) : tw * 1.6 + (1 - tw * 1.6) * Math.pow((u - 0.5) / 0.5, 0.8);
    const tc = Math.min(t, 0.995);
    const rad = rockProfile(sh, tc);
    for (let k = 0; k < SEG; k++) {
      const a = (k / SEG) * Math.PI * 2;
      // Jungle over the dome, starting higher on one side where a pale cliff face shows.
      const face = 0.12 * Math.max(0, Math.sin(a + ph));
      const cap = smoothstep(sh.cap - 0.1 + face, sh.cap + face, tc);
      // Never quite round: a lopsided plan (pulled in, never out, so the bird meets the rock
      // no later than drawn), jungle billowing on the cap, the stone fluted and gouged below.
      const plan = 1 - 0.09 * (1 + Math.sin(a * 2 + ph)) - 0.04 * (1 + Math.sin(a * 3 - ph * 2));
      const lump =
        plan *
        (1 +
          cap * (0.1 * Math.sin(a * 5 + ph) * Math.sin(tc * 19 + a * 2)) +
          (1 - cap) * (0.06 * Math.sin(a * 7 + ph + tc * 6) + 0.05 * Math.sin(a * 13 - tc * 11)));
      const lift = cap * 0.04 * Math.sin(a * 3 + ph * 2);
      pos.push(Math.cos(a) * rad * lump, (tc + lift) * sh.H, Math.sin(a) * rad * lump);
      c.copy(STONE).lerp(
        STONE_DARK,
        0.5 + 0.5 * Math.sin(a * 4 + ph + tc * 8) * 0.6 + rand() * 0.15,
      );
      c.lerp(NOTCH, 1 - smoothstep(0.02, 0.09, Math.abs(tc - tw - 0.02)));
      c.lerp(WET, 1 - smoothstep(tw - 0.04, tw, tc));
      g.copy(JUNGLE).lerp(JUNGLE_LIGHT, rand() * 0.5 + 0.4 * smoothstep(sh.cap, 1, tc));
      c.lerp(g, cap);
      col.push(c.r, c.g, c.b);
    }
  }
  const apex = pos.length / 3;
  pos.push(0, sh.H, 0);
  col.push(JUNGLE_LIGHT.r, JUNGLE_LIGHT.g, JUNGLE_LIGHT.b);
  for (let i = 0; i < RINGS; i++)
    for (let k = 0; k < SEG; k++) {
      const a = i * SEG + k;
      const b = i * SEG + ((k + 1) % SEG);
      idx.push(a, a + SEG, b, b, a + SEG, b + SEG);
    }
  const last = RINGS * SEG;
  for (let k = 0; k < SEG; k++) idx.push(last + k, apex, last + ((k + 1) % SEG));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * An overwater bungalow on stilts: a plank platform, warm timber walls and a tall thatched hip
 * roof, a little terrace on the lagoon side (+z) with a ladder down into the water. Its floor
 * sits at the pier's deck height (2.1 m), the roof ridge at 7.2 m.
 */
export function bungalowGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const x of [-3.2, 3.2])
    for (const z of [-3, 3, 5.6])
      parts.push(colored(new THREE.BoxGeometry(0.28, 4.2, 0.28), '#6d5a45', 0).translate(x, 0, z));
  parts.push(
    colored(new THREE.BoxGeometry(7.2, 0.35, 9.4), '#b79670', 2.1).translate(0, 0, 1.2),
    colored(new THREE.BoxGeometry(5.6, 2.5, 5.2), '#d9b98c', 3.5),
    colored(hipGeometry(0.25).scale(8, 2.6, 7.4), '#d6b46a', 4.6),
    colored(new THREE.BoxGeometry(0.5, 0.6, 0.5), '#a88a4e', 7.1),
    // Terrace rail and the ladder.
    colored(new THREE.BoxGeometry(7, 0.12, 0.12), '#8a6d50', 3.0).translate(0, 0, 5.8),
    colored(new THREE.BoxGeometry(0.9, 2.4, 0.1), '#8a6d50', 1.0).translate(2.4, 0, 5.95),
  );
  return mergeGeometries(parts)!;
}

/** Window and door panes of a bungalow (glow after dark), in its local metres. */
export function bungalowWindowsGeometry(): THREE.BufferGeometry {
  const parts = [
    new THREE.PlaneGeometry(1.2, 1.0).translate(-1.6, 3.6, 2.62),
    new THREE.PlaneGeometry(1.2, 1.0).translate(1.6, 3.6, 2.62),
    new THREE.PlaneGeometry(1.1, 1.9).rotateY(Math.PI).translate(0, 3.2, -2.62),
    new THREE.PlaneGeometry(1.0, 0.9).rotateY(Math.PI / 2).translate(2.82, 3.6, 0),
    new THREE.PlaneGeometry(1.0, 0.9).rotateY(-Math.PI / 2).translate(-2.82, 3.6, 0),
  ];
  for (const p of parts) p.deleteAttribute('uv');
  return mergeGeometries(parts)!;
}

/** One run of the pier: planks on two cross beams, a post at each end. Unit length along z. */
export function deckGeometry(): THREE.BufferGeometry {
  const parts = [colored(new THREE.BoxGeometry(2.6, 0.25, 1), '#b39a76', 2.0)];
  for (const z of [-0.45, 0.45])
    for (const x of [-1.15, 1.15])
      parts.push(
        colored(new THREE.BoxGeometry(0.22, 3.4, 0.05), '#6d5a45', 0.3).translate(x, 0, z),
      );
  return mergeGeometries(parts)!;
}

/** A little catamaran with a white sail, moored on the lagoon (lantern at the masthead). */
export function sailboatGeometry(): THREE.BufferGeometry {
  const sail = new THREE.BufferGeometry();
  // Main sail: a right triangle off the mast, both windings.
  const s = [0, 1.2, 0.2, 0, 7.6, 0.2, 0, 1.2, 3.6];
  sail.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [...s, s[0], s[1], s[2], s[6], s[7], s[8], s[3], s[4], s[5]],
      3,
    ),
  );
  const parts = [
    colored(new THREE.BoxGeometry(0.7, 0.5, 5.6), '#f2efe6', 0.15).translate(-1.3, 0, 0),
    colored(new THREE.BoxGeometry(0.7, 0.5, 5.6), '#f2efe6', 0.15).translate(1.3, 0, 0),
    colored(new THREE.BoxGeometry(3.3, 0.12, 2.8), '#c9b48d', 0.5).translate(0, 0, 0.2),
    colored(new THREE.CylinderGeometry(0.06, 0.07, 7.6, 4), '#d9d6cc', 4.2).translate(0, 0, 0.2),
    colored(sail, '#fbf7ef').translate(0, 0, 0),
  ];
  return mergeGeometries(parts)!;
}

/** An outrigger canoe: a slim dugout, a float on two booms, a paddle laid across. */
export function canoeGeometry(): THREE.BufferGeometry {
  const hull = new THREE.CylinderGeometry(0.45, 0.45, 6.4, 6, 1)
    .rotateX(Math.PI / 2)
    .scale(1, 0.6, 1);
  const float = new THREE.CylinderGeometry(0.2, 0.2, 3.6, 5, 1).rotateX(Math.PI / 2);
  const parts = [
    colored(hull, '#8b5a3a', 0.15),
    colored(float, '#a37a55', 0.05).translate(2.4, 0, 0),
    colored(new THREE.BoxGeometry(2.6, 0.08, 0.12), '#6d5a45', 0.45).translate(1.2, 0, 1),
    colored(new THREE.BoxGeometry(2.6, 0.08, 0.12), '#6d5a45', 0.45).translate(1.2, 0, -1),
    colored(new THREE.BoxGeometry(0.1, 0.05, 1.8), '#c49a5c', 0.55).translate(-0.1, 0, -0.4),
  ];
  return mergeGeometries(parts)!;
}

/** Lantern: a small, slightly tall ball (one shared shape, sized per instance). */
export function lanternGeometry(): THREE.BufferGeometry {
  return new THREE.SphereGeometry(0.4, 8, 6).scale(1, 1.25, 1);
}

/** Where things sit on the shapes above, in their local metres. */
export const SAIL_LANTERN = { x: 0, y: 8.0, z: 0.2 };
export const DECK_LANTERN = { x: 1.15, y: 3.2, z: 0.45 };
