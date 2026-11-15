import * as THREE from 'three';
import { Config } from '../../core/Config';
import type { ChunkDecor } from '../ChunkManager';
import { ContactShadows } from '../ContactShadows';
import { flockBirdGeometry } from '../highlands/shapes';
import { withMist } from '../Mist';
import { ShadowCasters } from '../ShadowCasters';
import { Trees } from '../Trees';
import {
  aleppoPineDetailGeometry,
  aleppoPineDistantGeometry,
  aleppoPineGeometry,
  archGeometry,
  boxGeometry,
  coneGeometry,
  cylinderGeometry,
  cypressDetailGeometry,
  cypressDistantGeometry,
  cypressGeometry,
  domeGeometry,
  hipGeometry,
  merlonsGeometry,
  octagonGeometry,
  oliveDetailGeometry,
  oliveDistantGeometry,
  oliveGeometry,
  onionGeometry,
  palmDetailGeometry,
  palmDistantGeometry,
  palmGeometry,
  pointedDomeGeometry,
  pyramidGeometry,
  sailsGeometry,
  solarGeometry,
} from './geometry';
import {
  BLOCK,
  MESH,
  MESH_COUNT,
  PART_STRIDE,
  STYLE,
  TREE_STRIDE,
  type JerusalemLayout,
} from './JerusalemLayout';
import { JerusalemScatter } from './JerusalemScatter';
import {
  createStoneMaterial,
  stonePropMaterial,
  withFoliageDetail,
  type StoneUniforms,
} from './materials';
import { PROP, PROP_KINDS, PROP_STRIDE } from './props';
import {
  awningGeometry,
  boulderGeometry,
  dryWallGeometry,
  goatGeometry,
  laundryGeometry,
  oleanderFarGeometry,
  oleanderGeometry,
  outcropFarGeometry,
  outcropGeometry,
  potsGeometry,
  scrubFarGeometry,
  scrubGeometry,
  sheepGeometry,
  shepherdGeometry,
  tanksGeometry,
} from './shapes';

/** One terrain chunk's City of Gold scenery. */
export interface JerusalemChunk {
  ox: number;
  oz: number;
  /** Stone parts (the layout's, PART_STRIDE records). */
  parts: number[];
  trees: number[];
  /** Rooftop clutter and market stalls on the chunk's houses (props.ts records). */
  roofs: number[];
  /** The country's small scenery, scattered the first time the chunk comes within reach. */
  props: number[] | null;
  /** Cypresses lining the roads (with the props). */
  lined: number[];
}

/** Starting stone capacities per mesh (grown on demand); the last is the near dome. */
const CAPACITY = [24000, 3000, 32, 32, 600, 600, 200, 32, 1500, 4000, 2000, 8, 64, 800];
const NAMES = [
  'box',
  'dome',
  'great-dome',
  'onion',
  'cylinder',
  'cone',
  'pyramid',
  'octagon',
  'merlons',
  'solar',
  'hip-roof',
  'sails',
  'arch',
  'dome-near',
];
/** The near (rounder) house dome's mesh index, after the layout's meshes. */
const DOME_NEAR = MESH_COUNT;
/** Stone casters' capacity per mesh near the bird (0: casts no shadow). */
const STONE_CASTS = [7000, 1600, 8, 16, 300, 300, 100, 16, 1600, 0, 1200, 0, 32, 0];

/** Per prop kind: drawn only within smallPropDistance. */
const SMALL = [0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1];
/** Per prop kind: instance capacity. */
const CAP = [3000, 4000, 9000, 3000, 9000, 1500, 1000, 120, 2500, 1500, 1500, 600, 600];
/** Per prop kind: casts a sun shadow (through near-only proxies). */
const CASTS = [1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0];
/** Per prop kind: contact-shadow radius at scale 1 (0 = none). */
const BLOB = [2.6, 1.3, 1.05, 1.7, 0, 0.65, 0.7, 0.45, 1.5, 0, 0.75, 2, 0];

const m = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler(0, 0, 0, 'YZX');
const p = new THREE.Vector3();
const sc = new THREE.Vector3();
const col = new THREE.Color();
/** Canvas dyes for the market stalls (multiplying pale stripes). */
const DYES = ['#f4a69a', '#9fc1ec', '#f6d27a', '#a9d6a0', '#f2f0ea', '#e9a3d0'].map(
  (h) => new THREE.Color(h),
);

/**
 * City of Gold's scenery: the stone as a dozen global instanced meshes (boxes, domes, drums,
 * spires, battlements, rooftop water heaters, tile roofs) in one stone material, four tree
 * shapes in three distances, and the country's small things (outcrops, garrigue, oleanders,
 * dry-stone walls, flocks and their shepherds, rooftop tanks, washing and pots, market stalls,
 * swifts) in near and far shapes, refilled from the live chunks whenever the chunk set changes
 * (matrices written into preallocated buffers). On high the stone, walls and big props cast
 * through near-only proxies; props get contact shadows on medium and high.
 */
export class JerusalemDecor implements ChunkDecor<JerusalemChunk> {
  readonly group = new THREE.Group();
  private readonly geometries: THREE.BufferGeometry[];
  private readonly material: THREE.Material;
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly stoneCasters: (ShadowCasters | null)[] = [];
  readonly trees = new Trees(
    14000,
    [oliveGeometry(), cypressGeometry(), aleppoPineGeometry(), palmGeometry()],
    [
      oliveDetailGeometry(),
      cypressDetailGeometry(),
      aleppoPineDetailGeometry(),
      palmDetailGeometry(),
    ],
    [
      oliveDistantGeometry(),
      cypressDistantGeometry(),
      aleppoPineDistantGeometry(),
      palmDistantGeometry(),
    ],
  );
  private readonly counts = CAPACITY.map(() => 0);
  private readonly colors = new Map<number, THREE.Color>();
  private readonly treeLists: number[][] = [];
  // Props.
  readonly propMaterial = stonePropMaterial();
  private readonly scatterer: JerusalemScatter;
  private readonly near: THREE.InstancedMesh[] = [];
  private readonly far: (THREE.InstancedMesh | null)[] = [];
  private readonly casters: (ShadowCasters | null)[] = [];
  private readonly contact = new ContactShadows(5000);
  private readonly nearCount = new Array<number>(PROP_KINDS).fill(0);
  private readonly farCount = new Array<number>(PROP_KINDS).fill(0);
  /** Scatter every chunk in reach at once (behind the title), not one a frame. */
  eager = false;
  /** The live chunks of the last refill (ChunkManager's list) and whether some await props. */
  private items: JerusalemChunk[] = [];
  private pendingProps = false;
  private px = 0;
  private pz = 0;
  private big2 = 0;
  private small2 = 0;
  private detail2 = 0;

  constructor(
    private readonly layout: JerusalemLayout,
    uniforms: StoneUniforms,
  ) {
    this.scatterer = new JerusalemScatter(layout);
    this.trees.ground = (x, z) => layout.height(x, z); // contact shadows lie on the slope
    this.material = createStoneMaterial(uniforms);
    withMist(withFoliageDetail(this.trees.material));
    this.geometries = [
      boxGeometry(),
      domeGeometry(),
      pointedDomeGeometry(),
      onionGeometry(),
      cylinderGeometry(),
      coneGeometry(),
      pyramidGeometry(),
      octagonGeometry(),
      merlonsGeometry(),
      solarGeometry(),
      hipGeometry(),
      sailsGeometry(),
      archGeometry(),
      domeGeometry(true),
    ];
    // Boxes (houses, walls, towers) get the painted rounded edge; other shapes keep theirs.
    this.geometries.forEach((g, k) => {
      const n = g.getAttribute('position').count;
      g.setAttribute(
        'aBevel',
        new THREE.BufferAttribute(new Float32Array(n).fill(k === 0 ? 1 : 0), 1),
      );
    });
    for (let k = 0; k < CAPACITY.length; k++) {
      this.meshes.push(this.make(k, CAPACITY[k]));
      const caster = STONE_CASTS[k]
        ? new ShadowCasters(this.geometries[k], this.material, STONE_CASTS[k])
        : null;
      this.stoneCasters.push(caster);
      if (caster) this.group.add(caster.mesh);
    }
    this.group.add(...this.meshes, this.trees.group);
    // Props: near shapes, far shapes for the kinds that have one.
    const near = [
      outcropGeometry(),
      boulderGeometry(1),
      scrubGeometry(),
      oleanderGeometry(),
      dryWallGeometry(true),
      goatGeometry(),
      sheepGeometry(),
      shepherdGeometry(),
      tanksGeometry(),
      laundryGeometry(),
      potsGeometry(),
      awningGeometry(),
      flockBirdGeometry(),
    ];
    const far: (THREE.BufferGeometry | null)[] = near.map(() => null);
    far[PROP.Outcrop] = outcropFarGeometry();
    far[PROP.Boulder] = boulderGeometry(0);
    far[PROP.Scrub] = scrubFarGeometry();
    far[PROP.Oleander] = oleanderFarGeometry();
    far[PROP.Wall] = dryWallGeometry(false);
    for (let k = 0; k < PROP_KINDS; k++) {
      this.near.push(this.makeProp(near[k], CAP[k], `jl-${k}`));
      const fg = far[k];
      this.far.push(fg ? this.makeProp(fg, CAP[k], `jl-${k}-far`) : null);
      // Casters use the cheaper shape where there is one: the shadow map is soft anyway.
      const caster = CASTS[k]
        ? new ShadowCasters(fg ?? near[k], this.propMaterial, Math.ceil(CAP[k] / 2))
        : null;
      this.casters.push(caster);
      if (caster) this.group.add(caster.mesh);
    }
    this.group.add(this.contact.mesh);
  }

  private make(k: number, cap: number): THREE.InstancedMesh {
    const geo = this.geometries[k];
    geo.setAttribute('aStyle', new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2));
    const mesh = new THREE.InstancedMesh(geo, this.material, cap);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    mesh.name = `jerusalem-${NAMES[k]}`;
    mesh.count = 0;
    mesh.frustumCulled = false; // instances span the whole view
    return mesh;
  }

  private makeProp(g: THREE.BufferGeometry, cap: number, name: string): THREE.InstancedMesh {
    if (!g.getAttribute('aAnim'))
      g.setAttribute(
        'aAnim',
        new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2),
      );
    const mesh = new THREE.InstancedMesh(g, this.propMaterial, cap);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.name = name;
    mesh.setColorAt(0, col.set('#fff'));
    this.group.add(mesh);
    return mesh;
  }

  scatter(ox: number, oz: number, size: number): JerusalemChunk {
    const parts: number[] = [];
    const trees: number[] = [];
    const roofs: number[] = [];
    const L = this.layout;
    const inside = (x: number, z: number) => x >= ox && x < ox + size && z >= oz && z < oz + size;
    const take = (src: number[], stride: number, out: number[]) => {
      for (let k = 0; k < src.length; k += stride)
        if (inside(src[k + 1], src[k + 3])) for (let c = 0; c < stride; c++) out.push(src[k + c]);
    };
    for (let j = Math.floor(oz / BLOCK); j < Math.ceil((oz + size) / BLOCK); j++)
      for (let i = Math.floor(ox / BLOCK); i < Math.ceil((ox + size) / BLOCK); i++) {
        const b = L.block(i, j);
        take(b.parts, PART_STRIDE, parts);
        take(b.trees, TREE_STRIDE, trees);
        take(b.props, PROP_STRIDE, roofs);
      }
    return { ox, oz, parts, trees, roofs, props: null, lined: [] };
  }

  private color(hex: number): THREE.Color {
    let c = this.colors.get(hex);
    if (!c) {
      c = new THREE.Color().setHex(hex); // sRGB in, linear stored
      this.colors.set(hex, c);
    }
    return c;
  }

  /** Small parts fade with the trees; walls, towers and landmarks stay to the horizon. */
  private visible(
    P: number[],
    k: number,
    px: number,
    pz: number,
    near2: number,
    far2: number,
  ): boolean {
    const d2 = (P[k + 1] - px) ** 2 + (P[k + 3] - pz) ** 2;
    if (d2 > far2) return false;
    if (d2 <= near2) return true;
    const st = P[k + 9];
    return P[k + 5] > 9 || st === STYLE.FLOOD || st === STYLE.GOLD;
  }

  /** The stone mesh a part is drawn with: house domes near the bird are the rounder ones. */
  private meshOf(P: number[], k: number, px: number, pz: number): number {
    const mi = P[k];
    if (mi !== MESH.DOME) return mi;
    const d2 = (P[k + 1] - px) ** 2 + (P[k + 3] - pz) ** 2;
    return d2 < this.detail2 ? DOME_NEAR : mi;
  }

  rebuild(items: JerusalemChunk[], px: number, pz: number): void {
    const R = Config.render;
    const far2 = R.drawDistance ** 2;
    const near2 = Math.max(R.treeDistance, R.drawDistance * 0.6) ** 2;
    this.px = px;
    this.pz = pz;
    this.big2 = R.propDistance ** 2;
    this.small2 = R.smallPropDistance ** 2;
    this.detail2 = R.propDetail ** 2;
    const counts = this.counts;
    counts.fill(0);
    for (const it of items)
      for (let k = 0; k < it.parts.length; k += PART_STRIDE)
        if (this.visible(it.parts, k, px, pz, near2, far2))
          counts[this.meshOf(it.parts, k, px, pz)]++;
    for (let mi = 0; mi < this.meshes.length; mi++) {
      const cap = this.meshes[mi].instanceMatrix.count;
      if (counts[mi] <= cap) continue;
      const old = this.meshes[mi];
      this.meshes[mi] = this.make(mi, Math.ceil(counts[mi] * 1.4));
      this.group.remove(old);
      old.dispose();
      this.group.add(this.meshes[mi]);
    }
    counts.fill(0);
    const size = Config.world.chunkSize;
    for (const c of this.stoneCasters) c?.begin(px, pz, size);
    for (const it of items) {
      const P = it.parts;
      for (let k = 0; k < P.length; k += PART_STRIDE) {
        if (!this.visible(P, k, px, pz, near2, far2)) continue;
        const mi = this.meshOf(P, k, px, pz);
        const mesh = this.meshes[mi];
        const i = counts[mi]++;
        const M = mesh.instanceMatrix.array as Float32Array;
        const o = i * 16;
        const sx = P[k + 4];
        const sy = P[k + 5];
        const sz = P[k + 6];
        const c = Math.cos(P[k + 7]);
        const s = Math.sin(P[k + 7]);
        // Scale then yaw (same layout as Matrix4.makeRotationY), translation to the part's base.
        M[o] = c * sx;
        M[o + 1] = 0;
        M[o + 2] = -s * sx;
        M[o + 3] = 0;
        M[o + 4] = 0;
        M[o + 5] = sy;
        M[o + 6] = 0;
        M[o + 7] = 0;
        M[o + 8] = s * sz;
        M[o + 9] = 0;
        M[o + 10] = c * sz;
        M[o + 11] = 0;
        M[o + 12] = P[k + 1];
        M[o + 13] = P[k + 2];
        M[o + 14] = P[k + 3];
        M[o + 15] = 1;
        const caster = this.stoneCasters[mi];
        if (caster) {
          m.fromArray(M, o);
          caster.add(P[k + 1], P[k + 3], m);
        }
        const cc = this.color(P[k + 8]);
        const C = mesh.instanceColor!.array as Float32Array;
        C[i * 3] = cc.r;
        C[i * 3 + 1] = cc.g;
        C[i * 3 + 2] = cc.b;
        const st = mesh.geometry.getAttribute('aStyle').array as Float32Array;
        st[i * 2] = P[k + 9];
        st[i * 2 + 1] = P[k + 10];
      }
    }
    for (let mi = 0; mi < this.meshes.length; mi++) {
      const mesh = this.meshes[mi];
      mesh.count = counts[mi];
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
      mesh.geometry.getAttribute('aStyle').needsUpdate = true;
      this.stoneCasters[mi]?.end();
    }
    // The country's props scatter lazily, the first time their chunk comes within reach: the
    // nearest one now, the rest one a frame (tick), so crossing into new ground never hitches.
    this.items = items;
    this.scatterNearest(this.eager ? Infinity : 1);
    const lists = this.treeLists;
    lists.length = 0;
    for (const c of items) {
      lists.push(c.trees);
      if (c.props) lists.push(c.lined);
    }
    this.trees.rebuild(lists, px, pz, R.treeDistance);
    this.placeProps();
  }

  /**
   * Scatter up to `budget` chunks in reach that have no props yet, nearest first; notes whether
   * any are left.
   */
  private scatterNearest(budget: number): boolean {
    const R = Config.render;
    const size = Config.world.chunkSize;
    const reach2 = (R.propDistance + size) ** 2;
    let did = false;
    this.pendingProps = false;
    while (budget > 0 && R.propDistance > 0) {
      let best: JerusalemChunk | null = null;
      let bestD = reach2;
      for (const c of this.items) {
        if (c.props) continue;
        const dx = Math.max(0, Math.abs(c.ox + size / 2 - this.px) - size / 2);
        const dz = Math.max(0, Math.abs(c.oz + size / 2 - this.pz) - size / 2);
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD) {
          bestD = d2;
          best = c;
        }
      }
      if (!best) return did;
      best.props = [];
      this.scatterer.scatter(best.ox, best.oz, size, best.props, best.lined);
      did = true;
      budget--;
    }
    this.pendingProps = R.propDistance > 0;
    return did;
  }

  /**
   * Once a frame: scatter one more chunk that came within reach and refill the props (the
   * stone and trees wait for the next full refill; a new chunk's road cypresses join then).
   */
  tick(): void {
    if (!this.pendingProps) return;
    if (this.scatterNearest(1)) this.placeProps();
  }

  /** Refill every prop mesh, its casters and contact shadows from the live chunks. */
  private placeProps(): void {
    const items = this.items;
    const size = Config.world.chunkSize;
    const px = this.px;
    const pz = this.pz;
    this.nearCount.fill(0);
    this.farCount.fill(0);
    for (const c of this.casters) c?.begin(px, pz, size);
    this.contact.begin(px, pz);
    for (const c of items) {
      this.place(c.roofs);
      if (c.props) this.place(c.props);
    }
    for (let k = 0; k < PROP_KINDS; k++) {
      this.finish(this.near[k], this.nearCount[k]);
      const f = this.far[k];
      if (f) this.finish(f, this.farCount[k]);
      this.casters[k]?.end();
    }
    this.contact.end();
  }

  private finish(mesh: THREE.InstancedMesh, n: number): void {
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  /** Instance every prop record of a list that is in range. */
  private place(list: readonly number[]): void {
    for (let k = 0; k < list.length; k += PROP_STRIDE) {
      const kind = list[k];
      const x = list[k + 1];
      const y = list[k + 2];
      const z = list[k + 3];
      const d2 = (x - this.px) ** 2 + (z - this.pz) ** 2;
      if (d2 > (SMALL[kind] ? this.small2 : this.big2)) continue;
      const farMesh = this.far[kind];
      const useFar = farMesh !== null && d2 > this.detail2;
      const mesh = useFar ? farMesh : this.near[kind];
      const counts = useFar ? this.farCount : this.nearCount;
      const idx = counts[kind];
      if (idx >= mesh.instanceMatrix.count) continue;
      e.set(0, list[k + 4], list[k + 5]);
      q.setFromEuler(e);
      m.compose(p.set(x, y, z), q, sc.set(list[k + 6], list[k + 7], list[k + 8]));
      mesh.setMatrixAt(idx, m);
      const t = list[k + 9];
      if (kind === PROP.Awning) col.copy(DYES[Math.floor(t * DYES.length) % DYES.length]);
      else col.setRGB(0.92 + t * 0.14, 0.92 + t * 0.1, 0.93 + (1 - t) * 0.1);
      mesh.setColorAt(idx, col);
      counts[kind] = idx + 1;
      this.casters[kind]?.add(x, z, m);
      if (BLOB[kind] > 0) this.contact.add(x, y, z, BLOB[kind] * list[k + 6], this.trees.ground);
    }
  }

  dispose(): void {
    for (const mesh of this.meshes) mesh.dispose();
    for (const g of this.geometries) g.dispose();
    for (const c of this.stoneCasters) c?.dispose();
    this.material.dispose();
    this.trees.dispose();
    for (const mesh of this.near) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    for (const mesh of this.far) {
      mesh?.geometry.dispose();
      mesh?.dispose();
    }
    for (const c of this.casters) c?.dispose();
    this.contact.dispose();
    this.propMaterial.dispose();
  }
}
