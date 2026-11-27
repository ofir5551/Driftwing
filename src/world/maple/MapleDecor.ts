import * as THREE from 'three';
import { Config } from '../../core/Config';
import { smoothstep } from '../../core/math';
import { nearestInReach, type ChunkDecor } from '../ChunkManager';
import { ContactShadows } from '../ContactShadows';
import type { DayCycle } from '../DayCycle';
import { withMist } from '../Mist';
import { ShadowCasters } from '../ShadowCasters';
import { getToonGradient } from '../Terrain';
import { Trees } from '../Trees';
import { commitInstances } from '../instances';
import { lanternGeometry } from '../karst/geometry';
import {
  CRIMSON,
  FLAME,
  TURNING,
  cedarDetailGeometry,
  cedarDistantGeometry,
  cedarGeometry,
  ginkgoDetailGeometry,
  ginkgoDistantGeometry,
  ginkgoGeometry,
  mapleDetailGeometry,
  mapleDistantGeometry,
  mapleGeometry,
} from './geometry';
import type { MapleLayout } from './MapleLayout';
import { WATER_GATE } from './MapleLayout';
import {
  FLOAT_STRIDE,
  K,
  KINDS,
  LANTERN_STRIDE,
  MapleScatter,
  PROP_STRIDE,
  type MapleChunk,
} from './MapleScatter';
import {
  boulderGeometry,
  bridgeGeometry,
  deerGeometry,
  farmerGeometry,
  farmhouseFarGeometry,
  farmhouseGeometry,
  floatGeometry,
  gateFarGeometry,
  gateGeometry,
  hallFarGeometry,
  hallGeometry,
  heronGeometry,
  pagodaFarGeometry,
  pagodaGeometry,
  paperGeometry,
  pavilionGeometry,
  shrineGeometry,
  stoneLantern,
} from './shapes';

/**
 * How far each prop kind is drawn, and where it swaps to its far shape: 0 always (pagodas,
 * halls, the lake's gate and pavilion, bridges), 1 out to the tree distance (shrines, gates,
 * farmhouses, stone lanterns; near shapes within twice propDetail), 2 within
 * smallPropDistance (boulders, herons, deer, farmers).
 */
const RANGE = [0, 0, 1, 1, 0, 0, 0, 1, 1, 2, 2, 2, 2];
/** Per kind: instance capacity. */
const CAP = [120, 120, 200, 2400, 2, 80, 2, 900, 900, 2000, 300, 300, 300];
/** Per kind: casts a sun shadow (high) through near-only proxies. */
const CASTS = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0];
/** Per kind: contact-shadow radius at scale 1 (0 = none), laid flat at the record's foot. */
const BLOB = [6.5, 10, 4.5, 0, 0, 0, 0, 0.7, 6.5, 1.2, 0, 1.0, 0.45];
/** Per kind: the record's y up to the ground at its foot (times its scale). */
const FOOT = [0.3, 0.3, 0.2, 0, 0, 0, 0, 0.1, 0.2, 0.2, 0, 0, 0];

const m = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler(0, 0, 0, 'YZX');
const p = new THREE.Vector3();
const sc = new THREE.Vector3();
const col = new THREE.Color();
const DAY_LANTERN = new THREE.Color('#e9dcc0');
// HDR (> 1) so bloom halos the lanterns after dark: warm candlelight through paper.
const NIGHT_LANTERN = new THREE.Color(4.4, 2.1, 0.75);
const DAY_PAPER = new THREE.Color('#f1e4c6');
const NIGHT_PAPER = new THREE.Color(5, 2.6, 1.0);

/**
 * Maple Valley's scenery as global instanced meshes refilled from the live chunks: the forest
 * (five tree types, near, far and distant shapes), temples (pagodas and halls), the tunnels'
 * gates and shrines, bridges, the lake's gate and pavilion, farmhouses, stone lanterns, the
 * small life, the floating lanterns drifting on the lake and the lantern lights that glow on
 * all of them after dark. Buildings swap to far shapes; small things appear within prop
 * distance. Buildings and gates cast sun shadows on high (near-only proxies); props get
 * contact shadows on medium and high. Refills write into preallocated instance buffers.
 */
export class MapleDecor implements ChunkDecor<MapleChunk> {
  readonly group = new THREE.Group();
  private readonly material: THREE.MeshToonMaterial;
  private readonly lanternMaterial: THREE.MeshBasicMaterial;
  private readonly paperMaterial: THREE.MeshBasicMaterial;
  private readonly scatterer: MapleScatter;
  private readonly near: THREE.InstancedMesh[] = [];
  private readonly far: (THREE.InstancedMesh | null)[] = [];
  private readonly casters: (ShadowCasters | null)[] = [];
  private readonly nearCount = new Array<number>(KINDS).fill(0);
  private readonly farCount = new Array<number>(KINDS).fill(0);
  private readonly lanterns: THREE.InstancedMesh;
  private readonly floats: THREE.InstancedMesh;
  private readonly papers: THREE.InstancedMesh;
  private readonly contact = new ContactShadows(3000);
  private readonly distantTrees = [
    mapleDistantGeometry(CRIMSON),
    mapleDistantGeometry(FLAME),
    mapleDistantGeometry(TURNING),
    ginkgoDistantGeometry(),
    cedarDistantGeometry(),
  ];
  // The forest is dense: its shadows are cast from the distant shapes (a crown's silhouette is
  // all a painted shadow needs), so the shadow pass costs a ninth of the near shapes'.
  readonly trees = new Trees(
    14000,
    [
      mapleGeometry(CRIMSON),
      mapleGeometry(FLAME),
      mapleGeometry(TURNING),
      ginkgoGeometry(),
      cedarGeometry(),
    ],
    [
      mapleDetailGeometry(CRIMSON),
      mapleDetailGeometry(FLAME),
      mapleDetailGeometry(TURNING),
      ginkgoDetailGeometry(),
      cedarDetailGeometry(),
    ],
    this.distantTrees,
    this.distantTrees,
  );
  private readonly treeLists: number[][] = [];
  /** The floating lanterns of the live chunks (FLOAT_STRIDE), moved every frame. */
  private floatList: number[] = [];
  private px = 0;
  private pz = 0;
  private range2 = [0, 0, 0];
  private detail2 = [0, 0, 0];
  private nl = 0;

  constructor(layout: MapleLayout) {
    this.scatterer = new MapleScatter(layout);
    this.trees.ground = (x, z) => layout.height(x, z);
    this.material = withMist(
      new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() }),
    );
    withMist(this.trees.material);
    this.lanternMaterial = new THREE.MeshBasicMaterial({ color: DAY_LANTERN.clone() });
    this.paperMaterial = new THREE.MeshBasicMaterial({ color: DAY_PAPER.clone() });
    const KM = Config.maple;
    const W = WATER_GATE;
    const near: THREE.BufferGeometry[] = [
      pagodaGeometry(),
      hallGeometry(),
      shrineGeometry(),
      gateGeometry(KM.gateHalf, KM.gateHeight),
      gateGeometry(W.half, W.top + 1.5),
      bridgeGeometry(),
      pavilionGeometry(),
      stoneLantern(),
      farmhouseGeometry(),
      boulderGeometry(5, 1),
      heronGeometry(),
      deerGeometry(),
      farmerGeometry(),
    ];
    const far: (THREE.BufferGeometry | null)[] = near.map(() => null);
    far[K.Pagoda] = pagodaFarGeometry();
    far[K.Hall] = hallFarGeometry();
    far[K.Farmhouse] = farmhouseFarGeometry();
    far[K.Gate] = gateFarGeometry(KM.gateHalf, KM.gateHeight);
    far[K.Boulder] = boulderGeometry(5, 0);
    const names = [
      'pagoda',
      'hall',
      'shrine',
      'gate',
      'water-gate',
      'bridge',
      'pavilion',
      'stone-lantern',
      'farmhouse',
      'boulder',
      'heron',
      'deer',
      'farmer',
    ];
    for (let k = 0; k < KINDS; k++) {
      this.near.push(this.make(near[k], CAP[k], names[k]));
      const fg = far[k];
      this.far.push(fg ? this.make(fg, CAP[k], `${names[k]}-far`) : null);
      const caster = CASTS[k] ? new ShadowCasters(fg ?? near[k], this.material, CAP[k]) : null;
      this.casters.push(caster);
      if (caster) this.group.add(caster.mesh);
    }
    this.lanterns = this.make(lanternGeometry(), 4000, 'lantern', this.lanternMaterial);
    this.floats = this.make(floatGeometry(), 200, 'float');
    this.papers = this.make(paperGeometry(), 200, 'float-paper', this.paperMaterial);
    this.group.add(this.trees.group, this.contact.mesh);
  }

  private make(
    geo: THREE.BufferGeometry,
    cap: number,
    name: string,
    mat: THREE.Material = this.material,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.name = name;
    this.group.add(mesh);
    return mesh;
  }

  scatter(ox: number, oz: number, size: number): MapleChunk {
    return this.scatterer.chunk(ox, oz, size);
  }

  private readonly bare = (c: MapleChunk): boolean => !c.props;

  /** Small things scatter lazily, the first time their chunk comes within reach: one a frame. */
  prepare(items: MapleChunk[], px: number, pz: number, budget: number): boolean {
    const R = Config.render;
    if (R.smallPropDistance <= 0) return false;
    const size = Config.world.chunkSize;
    const reach = R.smallPropDistance + size;
    for (;;) {
      const c = nearestInReach(items, px, pz, reach, this.bare);
      if (!c) return false;
      if (budget-- <= 0) return true;
      this.scatterer.props(c, size);
    }
  }

  rebuild(items: MapleChunk[], px: number, pz: number): void {
    const R = Config.render;
    const size = Config.world.chunkSize;
    const reach = R.smallPropDistance + size;
    const lists = this.treeLists;
    lists.length = 0;
    this.floatList = [];
    for (const c of items) {
      lists.push(c.trees);
      if (c.floats.length) this.floatList.push(...c.floats);
      if (!c.props && R.smallPropDistance > 0) {
        const dx = Math.max(0, Math.abs(c.ox + size / 2 - px) - size / 2);
        const dz = Math.max(0, Math.abs(c.oz + size / 2 - pz) - size / 2);
        if (dx * dx + dz * dz < reach * reach) this.scatterer.props(c, size);
      }
    }
    this.trees.rebuild(lists, px, pz, R.treeDistance);
    this.px = px;
    this.pz = pz;
    this.range2[0] = Infinity;
    this.range2[1] = R.treeDistance ** 2;
    this.range2[2] = R.smallPropDistance ** 2;
    this.detail2[0] = (R.propDetail * 3) ** 2;
    this.detail2[1] = (R.propDetail * 2) ** 2;
    this.detail2[2] = R.propDetail ** 2;
    this.nearCount.fill(0);
    this.farCount.fill(0);
    this.nl = 0;
    for (const c of this.casters) c?.begin(px, pz, size);
    this.contact.begin(px, pz);
    for (const c of items) {
      this.place(c.built);
      if (c.props) this.place(c.props);
      this.placeLanterns(c.lanterns);
    }
    for (let k = 0; k < KINDS; k++) {
      commitInstances(this.near[k], this.nearCount[k]);
      const f = this.far[k];
      if (f) commitInstances(f, this.farCount[k]);
      this.casters[k]?.end();
    }
    commitInstances(this.lanterns, this.nl);
    this.contact.end();
  }

  /** Instance every record of a chunk list that is in range. */
  private place(list: readonly number[]): void {
    for (let k = 0; k < list.length; k += PROP_STRIDE) {
      const kind = list[k];
      const x = list[k + 1];
      const y = list[k + 2];
      const z = list[k + 3];
      const d2 = (x - this.px) ** 2 + (z - this.pz) ** 2;
      const rg = RANGE[kind];
      if (d2 > this.range2[rg]) continue;
      const farMesh = this.far[kind];
      const useFar = farMesh !== null && d2 > this.detail2[rg];
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
      mesh.setColorAt(idx, col.setRGB(0.93 + t * 0.12, 0.94 + t * 0.07, 0.93 + (1 - t) * 0.09));
      counts[kind] = idx + 1;
      this.casters[kind]?.add(x, z, m);
      if (BLOB[kind] > 0) this.contact.add(x, y + FOOT[kind] * s, z, BLOB[kind] * s, null);
    }
  }

  /** Lantern lights of the things that are drawn (out to the tree distance). */
  private placeLanterns(list: readonly number[]): void {
    const max2 = this.range2[1];
    const cap = this.lanterns.instanceMatrix.count;
    for (let k = 0; k < list.length && this.nl < cap; k += LANTERN_STRIDE) {
      const x = list[k];
      const z = list[k + 2];
      if ((x - this.px) ** 2 + (z - this.pz) ** 2 > max2) continue;
      const s = list[k + 3];
      m.makeScale(s, s, s).setPosition(x, list[k + 1], z);
      this.lanterns.setMatrixAt(this.nl++, m);
    }
  }

  /**
   * Lanterns: pale stone and paper by day, glowing warm as the light goes; the floating
   * lanterns drift round their slow circles on the water, bobbing.
   */
  frame(day: DayCycle, time: number): void {
    const night = smoothstep(0.08, 0.6, day.palette.stars) * Config.maple.lanterns;
    this.lanternMaterial.color.copy(DAY_LANTERN).lerp(NIGHT_LANTERN, night);
    this.paperMaterial.color.copy(DAY_PAPER).lerp(NIGHT_PAPER, night);
    // The floating lanterns are set out on the water as the evening comes on.
    const out = smoothstep(0.02, 0.3, day.palette.stars);
    const F = this.floatList;
    const cap = this.floats.instanceMatrix.count;
    let n = 0;
    for (let k = 0; k < F.length && n < cap; k += FLOAT_STRIDE) {
      const a = F[k + 4] + time * F[k + 3];
      const x = F[k] + Math.cos(a) * F[k + 2];
      const z = F[k + 1] + Math.sin(a) * F[k + 2];
      const s = F[k + 5] * out;
      if (s <= 0.01) break;
      const bob = Math.sin(time * 1.3 + F[k + 4] * 3) * 0.04;
      q.setFromAxisAngle(p.set(0, 1, 0), a * 0.7);
      m.compose(p.set(x, bob - 0.05, z), q, sc.set(s, s, s));
      this.floats.setMatrixAt(n, m);
      this.papers.setMatrixAt(n, m);
      n++;
    }
    this.floats.count = n;
    this.papers.count = n;
    this.floats.instanceMatrix.needsUpdate = true;
    this.papers.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    const meshes = [...this.near, this.lanterns, this.floats, this.papers];
    for (const f of this.far) if (f) meshes.push(f);
    for (const mesh of meshes) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    for (const c of this.casters) c?.dispose();
    this.contact.dispose();
    this.material.dispose();
    this.lanternMaterial.dispose();
    this.paperMaterial.dispose();
    this.trees.dispose();
  }
}
