import * as THREE from 'three';
import { Config } from '../../core/Config';
import { nearestInReach, type ChunkDecor } from '../ChunkManager';
import { ContactShadows } from '../ContactShadows';
import type { DayCycle } from '../DayCycle';
import { withMist } from '../Mist';
import { ShadowCasters } from '../ShadowCasters';
import { getToonGradient } from '../Terrain';
import { Trees } from '../Trees';
import type { Berg, FjordLayout } from './FjordLayout';
import { FjordScatter } from './FjordScatter';
import { HOUSE_PAINTS, P, PROP_KINDS, PROP_STRIDE, type Fall } from './FjordSites';
import {
  bergGeometry,
  birchDistantGeometry,
  birchGeometry,
  birchNearGeometry,
  floeGeometry,
  spruceDetailGeometry,
  spruceDistantGeometry,
  spruceGeometry,
} from './geometry';
import { fjordUniforms, propMaterial } from './materials';
import {
  birdGeometry,
  boatGeometry,
  boathouseGeometry,
  boulderGeometry,
  churchGeometry,
  houseGeometry,
  jettyGeometry,
  rackGeometry,
  sealGeometry,
} from './shapes';
import { Waterfalls } from './Waterfalls';
import { commitInstances } from '../instances';

export interface FjordChunk {
  ox: number;
  oz: number;
  /** Trees in the Trees stride: type, x, y, z, scale, rotY, tint. */
  trees: number[];
  /** Village parts, gulls and floes: placed eagerly (PROP_STRIDE records). */
  sites: number[];
  /** Small scenery, scattered the first time the chunk comes within prop distance. */
  props: number[] | null;
  bergs: Berg[];
  falls: Fall[];
}

/** Per kind: 0 always drawn, 1 within propDistance, 2 within smallPropDistance. */
const RANGE = [0, 0, 0, 0, 1, 1, 2, 2, 1, 0];
/** Per kind: instance capacity. */
const CAP = [900, 60, 300, 120, 300, 200, 4000, 300, 300, 3000];
/** Per kind: casts a sun shadow (through near-only proxies, on high). */
const CASTS = [1, 1, 1, 1, 1, 0, 1, 0, 0, 0];
/** Per kind: contact-shadow radius at scale 1 (0 = none). */
const BLOB = [5.2, 8, 3.6, 0, 3.4, 0, 1.3, 1.1, 0, 0];
/** Per kind: animation mode in `aMove.w` (0 still, 1 a boat on the swell, 2 a circling bird). */
const MODE = [0, 0, 0, 0, 0, 1, 0, 0, 2, 0];

const BOATS = ['#2f5d8a', '#a83a34', '#3f6e4e', '#d9a441', '#ffffff'].map(
  (h) => new THREE.Color(h),
);
const PAINTS = HOUSE_PAINTS.map((h) => new THREE.Color(h));
const TAR = new THREE.Color('#463c38');
const FALU = new THREE.Color('#9e3a2e');
const EAGLE = new THREE.Color('#5b4632');
const DAY_WINDOW = new THREE.Color(0, 0, 0);
// HDR (> 1) so bloom halos the windows after dark.
const NIGHT_WINDOW = new THREE.Color(3.4, 2.0, 0.8);

const m = new THREE.Matrix4();
const q = new THREE.Quaternion();
const p = new THREE.Vector3();
const sc = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const col = new THREE.Color();

/**
 * Aurora Fjords' scenery as global instanced meshes refilled from the live chunks: spruce and
 * autumn birch (near, far and distant shapes), the fishing villages (wooden houses whose
 * windows warm after dark, a church, boathouses, jetties and moored boats, fish racks),
 * boulder beaches, sea ice with seals, icebergs, fishing boats out on the water, gulls and
 * sea eagles, and the waterfalls with their spray. Buildings, racks, rocks and bergs cast sun
 * shadows through near-only proxies; buildings, racks and rocks get contact shadows. Refilled
 * whenever the chunk set changes, writing into preallocated buffers.
 */
export class FjordDecor implements ChunkDecor<FjordChunk> {
  readonly group = new THREE.Group();
  readonly trees = new Trees(
    9000,
    [spruceGeometry(), birchGeometry()],
    [spruceDetailGeometry(), birchNearGeometry()],
    [spruceDistantGeometry(), birchDistantGeometry()],
  );
  private readonly prop = propMaterial();
  private readonly ice: THREE.MeshToonMaterial;
  private readonly scatterer: FjordScatter;
  private readonly near: THREE.InstancedMesh[] = [];
  private readonly far: (THREE.InstancedMesh | null)[] = [];
  private readonly casters: (ShadowCasters | null)[] = [];
  private readonly moves: (THREE.InstancedBufferAttribute | null)[] = [];
  private readonly bergs: THREE.InstancedMesh[];
  private readonly bergCasters: ShadowCasters[];
  private readonly contact = new ContactShadows(3000);
  readonly falls: Waterfalls;
  private readonly nearCount = new Array<number>(PROP_KINDS).fill(0);
  private readonly farCount = new Array<number>(PROP_KINDS).fill(0);
  private readonly bc = [0, 0];
  private readonly treeLists: number[][] = [];
  private px = 0;
  private pz = 0;
  private big2 = 0;
  private small2 = 0;
  private detail2 = 0;
  private readonly ground: (x: number, z: number) => number;

  constructor(private readonly layout: FjordLayout) {
    this.ground = (x, z) => layout.height(x, z);
    this.scatterer = new FjordScatter(layout);
    this.trees.ground = (x, z) => layout.height(x, z); // contact shadows lie on the slope
    withMist(this.trees.material);
    this.ice = withMist(
      new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() }),
    );
    const near: THREE.BufferGeometry[] = [
      houseGeometry(),
      churchGeometry(),
      boathouseGeometry(),
      jettyGeometry(),
      rackGeometry(),
      boatGeometry(),
      boulderGeometry(1),
      sealGeometry(),
      birdGeometry(),
      floeGeometry(16),
    ];
    const far: (THREE.BufferGeometry | null)[] = near.map(() => null);
    far[P.Boulder] = boulderGeometry(0);
    far[P.Floe] = floeGeometry(8);
    for (let k = 0; k < PROP_KINDS; k++) {
      const mat = k === P.Floe ? this.ice : this.prop;
      const move =
        mat === this.prop
          ? new THREE.InstancedBufferAttribute(new Float32Array(CAP[k] * 4), 4)
          : null;
      this.moves.push(move);
      this.near.push(this.make(near[k], mat, CAP[k], `fjord-${k}`, move));
      const fg = far[k];
      this.far.push(
        fg
          ? this.make(
              fg,
              mat,
              CAP[k],
              `fjord-${k}-far`,
              move ? new THREE.InstancedBufferAttribute(new Float32Array(CAP[k] * 4), 4) : null,
            )
          : null,
      );
      this.casters.push(CASTS[k] ? new ShadowCasters(near[k], mat, CAP[k]) : null);
    }
    const bergs = [bergGeometry(4), bergGeometry(7)];
    this.bergs = bergs.map((g, i) => this.make(g, this.ice, 300, `berg-${i}`, null));
    this.bergCasters = bergs.map((g) => new ShadowCasters(g, this.ice, 60));
    this.falls = new Waterfalls(layout);
    this.group.add(
      ...this.casters.flatMap((c) => (c ? [c.mesh] : [])),
      ...this.bergCasters.map((c) => c.mesh),
      this.trees.group,
      this.contact.mesh,
      this.falls.group,
    );
  }

  private make(
    g: THREE.BufferGeometry,
    mat: THREE.Material,
    cap: number,
    name: string,
    move: THREE.InstancedBufferAttribute | null,
  ): THREE.InstancedMesh {
    if (mat === this.prop) {
      if (!g.getAttribute('aFx'))
        g.setAttribute(
          'aFx',
          new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 3), 3),
        );
      // Every prop mesh carries its motion (zeros: still), never left to the attribute default.
      g.setAttribute('aMove', move!);
    }
    const mesh = new THREE.InstancedMesh(g, mat, cap);
    mesh.count = 0;
    mesh.frustumCulled = false; // instances span the view
    mesh.name = name; // shows up in scripts/level-shots.mjs's triangle report
    mesh.setColorAt(0, col.set('#fff'));
    this.group.add(mesh);
    return mesh;
  }

  scatter(ox: number, oz: number, size: number): FjordChunk {
    const L = this.layout;
    const out: FjordChunk = { ox, oz, trees: [], sites: [], props: null, bergs: [], falls: [] };
    this.scatterer.trees(ox, oz, size, out.trees);
    this.scatterer.sites(ox, oz, size, out.sites);
    const C = Config.fjord.bergCell;
    for (let j = Math.floor(oz / C); j <= Math.floor((oz + size) / C); j++)
      for (let i = Math.floor(ox / C); i <= Math.floor((ox + size) / C); i++) {
        const b = L.berg(i, j);
        if (b && b.x >= ox && b.x < ox + size && b.z >= oz && b.z < oz + size) out.bergs.push(b);
      }
    const inChunk = (f: Fall) => f.x1 >= ox && f.x1 < ox + size && f.z1 >= oz && f.z1 < oz + size;
    const H = L.sites.homeFall;
    if (H && inChunk(H)) out.falls.push(H);
    const F = Config.fjord.fallCell;
    for (let j = Math.floor((oz - 200) / F); j <= Math.floor((oz + size + 200) / F); j++)
      for (let i = Math.floor((ox - 200) / F); i <= Math.floor((ox + size + 200) / F); i++) {
        const f = L.sites.fall(i, j);
        if (f && inChunk(f)) out.falls.push(f);
      }
    return out;
  }

  private readonly bare = (c: FjordChunk): boolean => !c.props;

  /** Props scatter lazily, the first time their chunk comes within reach: one chunk a frame. */
  prepare(items: FjordChunk[], px: number, pz: number, budget: number): boolean {
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

  rebuild(items: FjordChunk[], px: number, pz: number): void {
    const R = Config.render;
    const size = Config.world.chunkSize;
    const reach = R.propDistance + size;
    const lists = this.treeLists;
    lists.length = 0;
    for (const c of items) {
      lists.push(c.trees);
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
    for (const c of this.bergCasters) c.begin(px, pz, size);
    this.contact.begin(px, pz);
    this.falls.begin();
    this.bc[0] = this.bc[1] = 0;
    for (const c of items) {
      this.place(c.sites);
      if (c.props) this.place(c.props);
      for (const b of c.bergs) {
        const k = b.seed < 0.5 ? 0 : 1;
        const mesh = this.bergs[k];
        if (this.bc[k] >= mesh.instanceMatrix.count) continue;
        q.setFromAxisAngle(up, b.yaw);
        m.compose(p.set(b.x, 0, b.z), q, sc.set(b.r, b.h, b.r));
        mesh.setMatrixAt(this.bc[k]++, m);
        this.bergCasters[k].add(b.x, b.z, m);
      }
      for (const f of c.falls) this.falls.add(f);
    }
    for (let k = 0; k < 2; k++) this.finish(this.bergs[k], this.bc[k], null);
    for (let k = 0; k < PROP_KINDS; k++) {
      this.finish(this.near[k], this.nearCount[k], this.moves[k]);
      const f = this.far[k];
      if (f)
        this.finish(
          f,
          this.farCount[k],
          f.geometry.getAttribute('aMove') as THREE.InstancedBufferAttribute | null,
        );
      this.casters[k]?.end();
    }
    for (const c of this.bergCasters) c.end();
    this.contact.end();
    this.falls.end();
  }

  private finish(
    mesh: THREE.InstancedMesh,
    n: number,
    move: THREE.InstancedBufferAttribute | null,
  ): void {
    commitInstances(mesh, n);
    if (move) move.needsUpdate = true;
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
      q.setFromAxisAngle(up, list[k + 4]);
      const s = list[k + 6];
      m.compose(p.set(x, y, z), q, sc.set(s, list[k + 7], list[k + 8]));
      mesh.setMatrixAt(idx, m);
      const t = list[k + 9];
      if (kind === P.House) col.copy(PAINTS[Math.floor(t * PAINTS.length) % PAINTS.length]);
      else if (kind === P.Boathouse) col.copy(t < 0.5 ? TAR : FALU);
      else if (kind === P.Boat) col.copy(BOATS[Math.floor(t * BOATS.length) % BOATS.length]);
      else if (kind === P.Bird) col.copy(t > 0.5 ? EAGLE : col.set('#fff'));
      else col.setRGB(0.94 + t * 0.12, 0.94 + t * 0.1, 0.94 + (1 - t) * 0.1);
      mesh.setColorAt(idx, col);
      const mv = mesh.geometry.getAttribute('aMove') as THREE.InstancedBufferAttribute | undefined;
      if (mv) {
        const r = list[k + 5];
        const a = mv.array as Float32Array;
        a[idx * 4] = Math.abs(r);
        a[idx * 4 + 1] = r < 0 ? -1 : 1;
        a[idx * 4 + 2] = kind === P.Bird ? (t > 0.5 ? 10 : 4) : 0;
        a[idx * 4 + 3] = MODE[kind];
      }
      counts[kind] = idx + 1;
      this.casters[kind]?.add(x, z, m);
      if (BLOB[kind] > 0)
        this.contact.add(x, y + 0.2, z, BLOB[kind] * s, kind === P.Boulder ? this.ground : null);
    }
  }

  /** Window glass: dark by day, warm lamplight as the light goes. */
  frame(day: DayCycle): void {
    const night =
      Math.min(Math.max((day.palette.stars - 0.08) / 0.52, 0), 1) * Config.fjord.windows;
    fjordUniforms.uWindow.value.copy(DAY_WINDOW).lerp(NIGHT_WINDOW, night);
  }

  dispose(): void {
    this.trees.dispose();
    for (const mesh of [...this.near, ...this.bergs]) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    for (const mesh of this.far) {
      mesh?.geometry.dispose();
      mesh?.dispose();
    }
    for (const c of this.casters) c?.dispose();
    for (const c of this.bergCasters) c.dispose();
    this.contact.dispose();
    this.falls.dispose();
    this.prop.dispose();
    this.ice.dispose();
  }
}
