import * as THREE from 'three';
import { Config } from '../../core/Config';
import { nearestInReach, type ChunkDecor } from '../ChunkManager';
import { ContactShadows } from '../ContactShadows';
import { withGroundDetail } from '../GroundDetail';
import { withMist } from '../Mist';
import { ShadowCasters } from '../ShadowCasters';
import { getToonGradient } from '../Terrain';
import { Trees } from '../Trees';
import type { Arch, CanyonLayout, Hoodoo } from './CanyonLayout';
import { CanyonScatter, P, PROP_KINDS, PROP_STRIDE } from './CanyonScatter';
import {
  archGeometry,
  boulderGeometry,
  browGeometry,
  cottonwoodGeometry,
  cottonwoodNearGeometry,
  hoodooGeometry,
  juniperGeometry,
  juniperNearGeometry,
  sageGeometry,
  willowGeometry,
  willowNearGeometry,
} from './geometry';
import { dustDevilMaterial, propMaterial } from './materials';
import { withRockStrata } from './rock';
import {
  cowGeometry,
  dustDevilGeometry,
  dwellingGeometry,
  fanGeometry,
  fenceGeometry,
  hawkGeometry,
  horseGeometry,
  ranchGeometry,
} from './shapes';
import { commitInstances } from '../instances';

export interface CanyonChunk {
  ox: number;
  oz: number;
  /** Trees in the Trees stride: type, x, y, z, scale, rotY, tint. */
  trees: number[];
  /** The sites (ranches, dwellings) whose centre is in the chunk: placed eagerly. */
  sites: number[];
  /** Small scenery, scattered the first time the chunk comes within prop distance. */
  props: number[] | null;
  hoodoos: Hoodoo[];
  arches: Arch[];
}

/** Per kind: 0 always drawn (landmarks), 1 within propDistance, 2 within smallPropDistance. */
const RANGE = [0, 0, 0, 0, 2, 2, 2, 2, 2, 1, 1];
/** Per kind: instance capacity. */
const CAP = [40, 40, 40, 40, 3000, 5000, 400, 200, 3000, 160, 60];
/** Per kind: casts a sun shadow (through near-only proxies, on high). */
const CASTS = [1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0];
/** Per kind: contact-shadow radius at scale 1 (0 = none). */
const BLOB = [0, 0, 0, 0, 1.3, 1.0, 1.1, 1.1, 0, 0, 0];
/** Per kind: rock (the strata material) rather than the painted props material. */
const ROCK = [0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0];

/** Coats for cattle (Hereford red, black, dun, roan) and horses (bay, chestnut, grey, black). */
const COWS = ['#8e4a2c', '#2f2a28', '#b98f62', '#7a5a4c'].map((h) => new THREE.Color(h));
const HORSES = ['#6b3f26', '#9a5a32', '#b8b0a6', '#2c2624'].map((h) => new THREE.Color(h));
const RAVEN = new THREE.Color('#2a2630');

const m = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler(0, 0, 0, 'YZX');
const p = new THREE.Vector3();
const sc = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const col = new THREE.Color();

/**
 * Red Canyons' scenery as global instanced meshes refilled from the live chunks: trees (near
 * and far shapes), arches, hoodoos (smooth near the bird, a cheaper cut beyond hoodooDetail),
 * the sites (ranches with a turning windmill, cliff dwellings under their brows), and the
 * small things (sagebrush, boulders, the road's fence, cattle and horses, hawks, dust devils).
 * Rock wears the walls' strata (rock.ts). Big things cast sun shadows through near-only
 * proxies; trees, rocks, shrubs and stock get contact shadows. Refilled whenever the chunk set
 * changes, writing into preallocated buffers.
 */
export class CanyonDecor implements ChunkDecor<CanyonChunk> {
  readonly group = new THREE.Group();
  readonly trees = new Trees(
    9000,
    [juniperGeometry(), cottonwoodGeometry(), willowGeometry()],
    [juniperNearGeometry(), cottonwoodNearGeometry(), willowNearGeometry()],
  );
  private readonly rock: THREE.MeshToonMaterial;
  private readonly prop = propMaterial();
  private readonly dust = dustDevilMaterial();
  private readonly scatterer: CanyonScatter;
  /** Hoodoos: near (smooth, 12 sides) and far; arches (two weatherings). */
  private readonly hoodoos: THREE.InstancedMesh[];
  private readonly arches: THREE.InstancedMesh[];
  private readonly rockCasters: ShadowCasters[];
  /** Per prop kind: its mesh, the far mesh of the kinds that have one, its shadow proxies. */
  private readonly near: THREE.InstancedMesh[] = [];
  private readonly far: (THREE.InstancedMesh | null)[] = [];
  private readonly casters: (ShadowCasters | null)[] = [];
  private readonly contact = new ContactShadows(5000);
  private readonly nearCount = new Array<number>(PROP_KINDS).fill(0);
  private readonly farCount = new Array<number>(PROP_KINDS).fill(0);
  private readonly hc = [0, 0];
  private readonly ac = [0, 0];
  private readonly treeLists: number[][] = [];
  // The refill round's centre and ranges (squared).
  private px = 0;
  private pz = 0;
  private big2 = 0;
  private small2 = 0;
  private detail2 = 0;

  constructor(private readonly layout: CanyonLayout) {
    this.scatterer = new CanyonScatter(layout);
    this.trees.ground = (x, z) => layout.height(x, z); // contact shadows lie on the slope
    withMist(this.trees.material);
    // The rock wears the walls' strata (per pixel, by world height) and the ground's painted
    // detail, over smooth-shaded shapes.
    this.rock = withRockStrata(
      withGroundDetail(
        withMist(
          new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() }),
        ),
      ),
      'decor',
    );
    const K = Config.canyon;
    const nearHoodoo = hoodooGeometry(K.hoodooSides, 14);
    const farHoodoo = hoodooGeometry(7, 7);
    this.hoodoos = [
      this.make(nearHoodoo, this.rock, 1200, 'hoodoo-near'),
      this.make(farHoodoo, this.rock, 3500, 'hoodoo'),
    ];
    const arches = [
      archGeometry(0.21, K.archRings, K.archSides),
      archGeometry(0.67, K.archRings, K.archSides),
    ];
    this.arches = arches.map((g, i) => this.make(g, this.rock, 40, `arch-${i}`));
    this.rockCasters = [
      new ShadowCasters(farHoodoo, this.rock, 1200),
      ...arches.map((g) => new ShadowCasters(g, this.rock, 40)),
    ];
    const near: THREE.BufferGeometry[] = [
      ranchGeometry(),
      fanGeometry(),
      dwellingGeometry(),
      browGeometry(),
      boulderGeometry(1),
      sageGeometry(),
      cowGeometry(),
      horseGeometry(),
      fenceGeometry(),
      hawkGeometry(),
      dustDevilGeometry(),
    ];
    const far: (THREE.BufferGeometry | null)[] = near.map(() => null);
    far[P.Boulder] = boulderGeometry(0);
    for (let k = 0; k < PROP_KINDS; k++) {
      const mat = k === P.DustDevil ? this.dust : ROCK[k] ? this.rock : this.prop;
      const mesh = this.make(near[k], mat, CAP[k], `canyon-${k}`);
      if (k === P.DustDevil) mesh.renderOrder = 2; // transparent, after the ground
      this.near.push(mesh);
      const fg = far[k];
      this.far.push(fg ? this.make(fg, mat, CAP[k], `canyon-${k}-far`) : null);
      const caster = CASTS[k] ? new ShadowCasters(near[k], mat, Math.ceil(CAP[k] / 3)) : null;
      this.casters.push(caster);
    }
    this.group.add(
      ...this.rockCasters.map((c) => c.mesh),
      ...this.casters.flatMap((c) => (c ? [c.mesh] : [])),
      this.trees.group,
      this.contact.mesh,
    );
  }

  private make(
    g: THREE.BufferGeometry,
    mat: THREE.Material,
    cap: number,
    name: string,
  ): THREE.InstancedMesh {
    if (mat === this.prop && !g.getAttribute('aAnim'))
      g.setAttribute(
        'aAnim',
        new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2),
      );
    const mesh = new THREE.InstancedMesh(g, mat, cap);
    mesh.count = 0;
    mesh.frustumCulled = false; // instances span the view
    mesh.name = name; // shows up in scripts/level-shots.mjs's triangle report
    mesh.setColorAt(0, col.set('#fff'));
    this.group.add(mesh);
    return mesh;
  }

  scatter(ox: number, oz: number, size: number): CanyonChunk {
    const L = this.layout;
    const out: CanyonChunk = { ox, oz, trees: [], sites: [], props: null, hoodoos: [], arches: [] };
    this.scatterer.trees(ox, oz, size, out.trees);
    this.scatterer.sites(ox, oz, size, out.sites);
    const H = Config.canyon.hoodooCell;
    for (let j = Math.floor(oz / H); j < Math.ceil((oz + size) / H); j++)
      for (let i = Math.floor(ox / H); i < Math.ceil((ox + size) / H); i++) {
        const hd = L.hoodoo(i, j);
        if (hd && hd.x >= ox && hd.x < ox + size && hd.z >= oz && hd.z < oz + size)
          out.hoodoos.push(hd);
      }
    const A = Config.canyon.archCell;
    for (let j = Math.floor(oz / A); j <= Math.floor((oz + size) / A); j++)
      for (let i = Math.floor(ox / A); i <= Math.floor((ox + size) / A); i++) {
        const a = L.arch(i, j);
        if (a && a.x >= ox && a.x < ox + size && a.z >= oz && a.z < oz + size) out.arches.push(a);
      }
    const G = L.great;
    if (G.x >= ox && G.x < ox + size && G.z >= oz && G.z < oz + size) out.arches.push(G);
    return out;
  }

  private readonly bare = (c: CanyonChunk): boolean => !c.props;

  /** Props scatter lazily, the first time their chunk comes within reach: one chunk a frame. */
  prepare(items: CanyonChunk[], px: number, pz: number, budget: number): boolean {
    const R = Config.render;
    if (R.propDistance <= 0) return false;
    const size = Config.world.chunkSize;
    for (;;) {
      const c = nearestInReach(items, px, pz, R.propDistance + size, this.bare);
      if (!c) return false;
      if (budget-- <= 0) return true;
      c.props = [];
      this.scatterer.props(c.ox, c.oz, size, c.props);
    }
  }

  rebuild(items: CanyonChunk[], px: number, pz: number): void {
    const R = Config.render;
    const size = Config.world.chunkSize;
    const reach = R.propDistance + size;
    const lists = this.treeLists;
    lists.length = 0;
    for (const c of items) {
      lists.push(c.trees);
      // Props scatter lazily, the first time their chunk comes within reach.
      if (!c.props && R.propDistance > 0) {
        const dx = Math.max(0, Math.abs(c.ox + size / 2 - px) - size / 2);
        const dz = Math.max(0, Math.abs(c.oz + size / 2 - pz) - size / 2);
        if (dx * dx + dz * dz < reach * reach) {
          c.props = [];
          this.scatterer.props(c.ox, c.oz, size, c.props);
        }
      }
    }
    this.trees.rebuild(lists, px, pz, R.treeDistance);

    this.px = px;
    this.pz = pz;
    this.big2 = R.propDistance ** 2;
    this.small2 = R.smallPropDistance ** 2;
    this.detail2 = R.propDetail ** 2;
    this.nearCount.fill(0);
    this.farCount.fill(0);
    for (const c of this.casters) c?.begin(px, pz, size);
    for (const c of this.rockCasters) c.begin(px, pz, size);
    this.contact.begin(px, pz);
    this.hc[0] = this.hc[1] = 0;
    this.ac[0] = this.ac[1] = 0;
    const rock2 = R.hoodooDetail ** 2;
    for (const c of items) {
      this.place(c.sites);
      if (c.props) this.place(c.props);
      for (const hd of c.hoodoos) {
        const d2 = (hd.x - px) ** 2 + (hd.z - pz) ** 2;
        const k = d2 < rock2 ? 0 : 1;
        const mesh = this.hoodoos[k];
        if (this.hc[k] >= mesh.instanceMatrix.count) continue;
        q.setFromAxisAngle(up, hd.yaw);
        const w = hd.slim ? hd.r * 0.8 : hd.r;
        m.compose(p.set(hd.x, hd.y0, hd.z), q, sc.set(w, hd.h, w));
        mesh.setMatrixAt(this.hc[k]++, m);
        this.rockCasters[0].add(hd.x, hd.z, m);
        this.contact.add(hd.x, hd.y0 + 1, hd.z, hd.r * 1.25, null);
      }
      for (const a of c.arches) {
        const k = a.seed < 0.5 ? 0 : 1;
        const mesh = this.arches[k];
        if (this.ac[k] >= mesh.instanceMatrix.count) continue;
        q.setFromAxisAngle(up, a.yaw);
        m.compose(p.set(a.x, a.y0, a.z), q, sc.set(a.r, a.h, a.d));
        mesh.setMatrixAt(this.ac[k]++, m);
        this.rockCasters[1 + k].add(a.x, a.z, m);
      }
    }
    for (let k = 0; k < 2; k++) {
      this.finish(this.hoodoos[k], this.hc[k]);
      this.finish(this.arches[k], this.ac[k]);
    }
    for (let k = 0; k < PROP_KINDS; k++) {
      this.finish(this.near[k], this.nearCount[k]);
      const f = this.far[k];
      if (f) this.finish(f, this.farCount[k]);
      this.casters[k]?.end();
    }
    for (const c of this.rockCasters) c.end();
    this.contact.end();
  }

  private finish(mesh: THREE.InstancedMesh, n: number): void {
    commitInstances(mesh, n);
  }

  /** Instance every record of a chunk list that is in range. */
  private place(list: readonly number[]): void {
    for (let k = 0; k < list.length; k += PROP_STRIDE) {
      const kind = list[k];
      const x = list[k + 1];
      const y = list[k + 2];
      const z = list[k + 3];
      const d2 = (x - this.px) ** 2 + (z - this.pz) ** 2;
      const range = RANGE[kind];
      if ((range === 1 && d2 > this.big2) || (range === 2 && d2 > this.small2)) continue;
      const farMesh = this.far[kind];
      const useFar = farMesh !== null && d2 > this.detail2;
      const mesh = useFar ? farMesh : this.near[kind];
      const counts = useFar ? this.farCount : this.nearCount;
      const idx = counts[kind];
      if (idx >= mesh.instanceMatrix.count) continue;
      e.set(0, list[k + 4], list[k + 5]);
      q.setFromEuler(e);
      const s = list[k + 6];
      m.compose(p.set(x, y, z), q, sc.set(s, list[k + 7], list[k + 8]));
      mesh.setMatrixAt(idx, m);
      const t = list[k + 9];
      if (kind === P.Cow) col.copy(COWS[Math.floor(t * COWS.length) % COWS.length]);
      else if (kind === P.Horse) col.copy(HORSES[Math.floor(t * HORSES.length) % HORSES.length]);
      else if (kind === P.Hawk) col.copy(t > 0.5 ? col.set('#fff') : RAVEN);
      else col.setRGB(0.92 + t * 0.14, 0.92 + t * 0.1, 0.92 + (1 - t) * 0.1);
      mesh.setColorAt(idx, col);
      counts[kind] = idx + 1;
      this.casters[kind]?.add(x, z, m);
      if (BLOB[kind] > 0) this.contact.add(x, y + 0.2 * s, z, BLOB[kind] * s, null);
    }
  }

  dispose(): void {
    this.trees.dispose();
    for (const mesh of [...this.hoodoos, ...this.arches, ...this.near]) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    for (const mesh of this.far) {
      mesh?.geometry.dispose();
      mesh?.dispose();
    }
    for (const c of this.casters) c?.dispose();
    for (const c of this.rockCasters) c.dispose();
    this.contact.dispose();
    this.rock.dispose();
    this.prop.dispose();
    this.dust.dispose();
  }
}
