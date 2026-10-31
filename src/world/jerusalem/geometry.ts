import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../noise';
import { colored, limb, lobe, painted, topLit } from '../Trees';

/**
 * City of Gold's shapes. The instanced unit shapes sit on y = 0 with a 1 x 1 footprint centred
 * on the origin and a height of 1 (the instance matrix scales them to size); the stone shader
 * colours them per instance, so they carry white vertex colours (the water heater and the
 * merlons are built in metres and painted). Trees are built in metres.
 */

/** White vertex colours, so instance colours show through unchanged. */
function white(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.deleteAttribute('uv');
  const n = g.getAttribute('position').count;
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  return g;
}

/** Non-indexed with per-face normals: crisp facets for boxes, prisms and roofs. */
function faceted(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  ng.computeVertexNormals();
  return white(ng);
}

export function boxGeometry(): THREE.BufferGeometry {
  return faceted(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
}

/** A low hemisphere (a house dome): smooth-shaded so the toon bands sweep round it. */
export function domeGeometry(): THREE.BufferGeometry {
  return white(new THREE.SphereGeometry(0.5, 10, 3, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 2, 1));
}

/** Lathe a profile of [radius, height] points into a smooth solid of revolution. */
function lathe(points: [number, number][], segments: number): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(
    points.map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
  );
  g.computeVertexNormals();
  return white(g);
}

/** A great dome: full at the shoulder, gently pointed at the crown (the Dome of the Rock). */
export function pointedDomeGeometry(): THREE.BufferGeometry {
  const pts: [number, number][] = [];
  for (let k = 0; k <= 12; k++) {
    const a = (k / 12) * (Math.PI / 2);
    pts.push([0.5 * Math.cos(a) * (1 + 0.06 * Math.sin(a * 2)), Math.pow(Math.sin(a), 0.8)]);
  }
  pts[12][0] = 0;
  return lathe(pts, 24);
}

/** A Russian onion dome: swelling out past its drum, pinched to a point. */
export function onionGeometry(): THREE.BufferGeometry {
  return lathe(
    [
      [0.36, 0],
      [0.47, 0.1],
      [0.54, 0.24],
      [0.52, 0.38],
      [0.42, 0.53],
      [0.26, 0.68],
      [0.12, 0.8],
      [0.05, 0.9],
      [0.02, 1],
      [0, 1],
    ],
    14,
  );
}

export function cylinderGeometry(): THREE.BufferGeometry {
  return white(new THREE.CylinderGeometry(0.5, 0.5, 1, 14).translate(0, 0.5, 0));
}

export function coneGeometry(): THREE.BufferGeometry {
  return white(new THREE.ConeGeometry(0.5, 1, 14).translate(0, 0.5, 0));
}

/** Four-sided spire roof whose base fills the unit square. */
export function pyramidGeometry(): THREE.BufferGeometry {
  return faceted(
    new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0),
  );
}

/** Octagonal prism (circumradius 0.5), a flat face toward each axis. */
export function octagonGeometry(): THREE.BufferGeometry {
  return faceted(
    new THREE.CylinderGeometry(0.5, 0.5, 1, 8).rotateY(Math.PI / 8).translate(0, 0.5, 0),
  );
}

/**
 * Battlements for 8 m of wall top, in metres: four merlons with low pointed caps along the
 * outer edge (local +z), the Ottoman walls' silhouette.
 */
export function merlonsGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const x of [-3, -1, 1, 3]) {
    parts.push(
      colored(new THREE.BoxGeometry(1.15, 1.3, 0.9).translate(x, 0, 1.15), '#ffffff', 0.65),
      colored(
        new THREE.ConeGeometry(0.8, 0.45, 4).rotateY(Math.PI / 4).translate(x, 0, 1.15),
        '#ffffff',
        1.52,
      ),
    );
  }
  // A low parapet on the walkway side.
  parts.push(colored(new THREE.BoxGeometry(8, 0.6, 0.4).translate(0, 0, -1.4), '#ffffff', 0.3));
  return mergeGeometries(parts)!;
}

/** A rooftop solar water heater: a white tank lying on a frame behind a tilted dark panel. */
export function solarGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    colored(
      new THREE.CylinderGeometry(0.33, 0.33, 1.5, 6).rotateZ(Math.PI / 2).translate(0, 0, -0.55),
      '#e4e2dc',
      1.25,
    ),
    colored(
      new THREE.BoxGeometry(1.5, 0.06, 1.3).rotateX(0.7).translate(0, 0, 0.25),
      '#2d3d58',
      0.6,
    ),
  ])!;
}

/** A round-topped arch as a slab (a gateway's dark opening, a sealed arch), 1 wide and tall. */
export function archGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-0.5, 0);
  s.lineTo(0.5, 0);
  s.lineTo(0.5, 0.5);
  s.absarc(0, 0.5, 0.5, 0, Math.PI, false);
  s.lineTo(-0.5, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, curveSegments: 6 });
  return faceted(g.translate(0, 0, -0.5));
}

/** Hipped tile roof: a short ridge along x, sloping on all four sides. */
export function hipGeometry(): THREE.BufferGeometry {
  const t: number[] = [];
  const A = [-0.5, 0, -0.5];
  const B = [0.5, 0, -0.5];
  const Cc = [0.5, 0, 0.5];
  const D = [-0.5, 0, 0.5];
  const R1 = [-0.22, 1, 0];
  const R2 = [0.22, 1, 0];
  t.push(...D, ...Cc, ...R2, ...D, ...R2, ...R1); // front
  t.push(...B, ...A, ...R1, ...B, ...R1, ...R2); // back
  t.push(...A, ...D, ...R1); // ends
  t.push(...Cc, ...B, ...R2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(t, 3));
  return faceted(g);
}

/** Four windmill sails in the local x-y plane (facing +-z), a lattice frame on each. */
export function sailsGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const blade = new THREE.BoxGeometry(0.11, 0.42, 0.02).translate(0.03, 0.27, 0).rotateZ(a);
    const spar = new THREE.BoxGeometry(0.02, 0.5, 0.03).translate(0, 0.25, 0).rotateZ(a);
    parts.push(colored(blade, '#ece8de'), colored(spar, '#6b5a48'));
  }
  return mergeGeometries(parts)!;
}

// --- Trees (metres, vertex-coloured, for the shared Trees meshes) --------------------------

/** Olive: a short, twisted grey trunk under a broad, silvery, flat-topped crown. */
export function oliveGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.22, 0.42, 2, 4, 1, true).rotateZ(0.18);
  const crown = new THREE.IcosahedronGeometry(2.3, 0).scale(1.25, 0.72, 1.15);
  const side = new THREE.OctahedronGeometry(1.5).scale(1.1, 0.8, 1.1).translate(1.2, 0.5, 0.6);
  return topLit(
    mergeGeometries([
      colored(trunk, '#6e6152', 1),
      colored(crown, '#8e9a6d', 2.9),
      colored(side, '#a2ab83', 2.9),
    ])!,
    0.7,
    1.12,
  );
}

/** Italian cypress: a tall, dark green flame. */
export function cypressGeometry(): THREE.BufferGeometry {
  const body = new THREE.IcosahedronGeometry(1, 0).scale(1.05, 5.6, 1.05);
  return topLit(
    mergeGeometries([
      colored(new THREE.CylinderGeometry(0.15, 0.22, 1.2, 4, 1, true), '#5b4a3c', 0.6),
      colored(body, '#3c5838', 6.4),
    ])!,
    0.72,
    1.1,
  );
}

/** Aleppo pine: a leaning trunk carrying a wide, open, umbrella crown. */
export function aleppoPineGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.2, 0.35, 6, 4, 1, true)
    .translate(0, 3, 0)
    .rotateZ(-0.16);
  const crown = new THREE.IcosahedronGeometry(2.8, 0).scale(1.35, 0.55, 1.25);
  const top = new THREE.OctahedronGeometry(1.8).scale(1.2, 0.6, 1.1).translate(-0.8, 0.9, 0.4);
  return topLit(
    mergeGeometries([
      colored(trunk, '#76604c'),
      colored(crown.translate(1, 0, 0), '#5d7a4c', 6.4),
      colored(top.translate(1, 0, 0), '#6c8a56', 6.4),
    ])!,
    0.7,
    1.1,
  );
}

/** Date palm: a tall slim trunk and a burst of drooping fronds. */
export function palmGeometry(): THREE.BufferGeometry {
  const rand = mulberry32(17);
  const parts: THREE.BufferGeometry[] = [
    colored(new THREE.CylinderGeometry(0.22, 0.32, 9, 4, 1, true).translate(0, 4.5, 0), '#8d7454'),
  ];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + rand() * 0.3;
    const frond = new THREE.OctahedronGeometry(1).scale(2.6, 0.18, 0.55).translate(2.2, 0, 0);
    frond.rotateZ(-0.35 - rand() * 0.25).rotateY(a);
    parts.push(colored(frond, k % 2 ? '#6f8f4c' : '#7f9d57', 9));
  }
  return topLit(mergeGeometries(parts)!, 0.75, 1.08);
}

// --- Near trees: detailed shapes for the ring round the bird (Config.render.treeDetail) ----

/**
 * Near olive (~120 triangles: groves are dense, so it stays lean): two gnarled stems twisting
 * apart under a broad, flat crown of four silvery lobes, so groves read as grey-green clouds.
 */
export function oliveDetailGeometry(): THREE.BufferGeometry {
  const bark = '#6a5d4f';
  const parts = [limb(0.7, 0, 2.6, 0.3, 0.34, bark), limb(-0.6, 0, 2.4, -0.4, 0.3, bark)];
  const lobes: [number, number, number, number, string][] = [
    [1.8, 0.2, 3.0, 0, '#8e9a6d'],
    [1.5, 1.6, 2.8, 0.7, '#9aa57a'],
    [1.5, -1.3, 2.7, -0.6, '#87946a'],
    [1.2, 0.3, 3.6, -0.9, '#aab38b'],
  ];
  lobes.forEach(([r, x, y, z, hex], i) => parts.push(lobe(r, x, y, z, hex, 60 + i, 0.62)));
  return topLit(mergeGeometries(parts)!, 0.7, 1.12);
}

/** Near cypress (~90 triangles): a dark flame of four stacked, lumpy lobes, narrowing to a tip. */
export function cypressDetailGeometry(): THREE.BufferGeometry {
  const parts = [colored(new THREE.CylinderGeometry(0.15, 0.24, 1.4, 5), '#5b4a3c', 0.7)];
  const tiers: [number, number, string][] = [
    [1.1, 2.4, '#3a5636'],
    [1.05, 4.6, '#3e5c3a'],
    [0.85, 6.8, '#43623e'],
    [0.55, 8.7, '#4b6b44'],
  ];
  tiers.forEach(([r, y, hex], i) => parts.push(lobe(r, 0, y, 0, hex, 70 + i, 2.1)));
  return topLit(mergeGeometries(parts)!, 0.72, 1.1);
}

/**
 * Near Aleppo pine (~210 triangles): a leaning trunk that forks into two limbs carrying a wide,
 * open umbrella of flat foliage pads, with sky showing between them.
 */
export function aleppoPineDetailGeometry(): THREE.BufferGeometry {
  const bark = '#76604c';
  const trunk = new THREE.CylinderGeometry(0.2, 0.36, 5, 5).translate(0, 2.5, 0).rotateZ(-0.16);
  const parts = [
    colored(trunk, bark),
    limb(1.6, 4.6, 6.2, 0.5, 0.2, bark),
    limb(0.2, 4.7, 6.3, -1.2, 0.18, bark),
  ];
  const pads: [number, number, number, number, string][] = [
    [2.0, 1.1, 6.6, 0, '#5d7a4c'],
    [1.6, 2.6, 6.3, 0.9, '#577246'],
    [1.7, -0.4, 6.4, 0.9, '#6c8a56'],
    [1.5, 0.6, 6.5, -1.6, '#5d7a4c'],
    [1.5, 2.4, 6.6, -1.1, '#668450'],
    [1.2, 1.2, 7.4, -0.2, '#73915c'],
  ];
  pads.forEach(([r, x, y, z, hex], i) => parts.push(lobe(r, x, y, z, hex, 80 + i, 0.48)));
  return topLit(mergeGeometries(parts)!, 0.7, 1.1);
}

/**
 * Near date palm (~200 triangles): a ringed trunk under ten fronds that rise from the crown and
 * break downward halfway out, with a cluster of dates beneath.
 */
export function palmDetailGeometry(): THREE.BufferGeometry {
  const rand = mulberry32(23);
  const dark = new THREE.Color('#7a6249');
  const light = new THREE.Color('#9a8061');
  // Leaf-scar rings up the trunk: the colour alternates ring by ring.
  const trunk = painted(
    new THREE.CylinderGeometry(0.24, 0.34, 9, 6, 9, true).translate(0, 4.5, 0),
    (_x, y, _z, out) => out.copy(Math.round(y) % 2 ? dark : light),
  );
  const parts = [trunk];
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + rand() * 0.3;
    const up = 0.25 + rand() * 0.25;
    const hex = k % 2 ? '#6f8f4c' : '#7f9d57';
    // Inner blade rises, outer blade droops from where the inner one ends.
    const inner = new THREE.OctahedronGeometry(1).scale(1.4, 0.1, 0.42).translate(1.4, 0, 0);
    inner.rotateZ(up);
    const outer = new THREE.OctahedronGeometry(1).scale(1.3, 0.08, 0.36).translate(1.3, 0, 0);
    outer.rotateZ(-0.7 - rand() * 0.3).translate(2.8 * Math.cos(up), 2.8 * Math.sin(up), 0);
    for (const blade of [inner, outer]) {
      blade.rotateY(a);
      parts.push(colored(blade, hex, 9));
    }
  }
  parts.push(colored(new THREE.IcosahedronGeometry(0.45, 0).scale(1, 1.3, 1), '#b5733c', 8.5));
  return topLit(mergeGeometries(parts)!, 0.75, 1.08);
}
