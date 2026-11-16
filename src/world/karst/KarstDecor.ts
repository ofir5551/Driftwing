import * as THREE from 'three';
import { Config } from '../../core/Config';
import { smoothstep } from '../../core/math';
import { nearestInReach, type ChunkDecor } from '../ChunkManager';
import { ContactShadows } from '../ContactShadows';
import type { DayCycle } from '../DayCycle';
import { withGroundDetail } from '../GroundDetail';
import { withMist } from '../Mist';
import { ShadowCasters } from '../ShadowCasters';
import { getToonGradient } from '../Terrain';
import {
  pineDetailGeometry,
  pineGeometry,
  roundTreeDetailGeometry,
  roundTreeGeometry,
  Trees,
} from '../Trees';
import {
  bambooDetailGeometry,
  bambooGeometry,
  lanternGeometry,
  pillarGeometry,
  soften,
} from './geometry';
import { SHAPES, type KarstLayout } from './KarstLayout';
import {
  K,
  KarstScatter,
  KINDS,
  LANTERN_STRIDE,
  PROP_STRIDE,
  VINE_STRIDE,
  type KarstChunk,
} from './KarstScatter';
import { setRockDetail, withRockDetail } from './rock';
import {
  boulderGeometry,
  bridgeGeometry,
  buffaloGeometry,
  farmerGeometry,
  hallFarGeometry,
  hallGeometry,
  houseFarGeometry,
  houseGeometry,
  pagodaGeometry,
  pavilionGeometry,
  raftFarGeometry,
  raftGeometry,
  sampanGeometry,
  vineGeometry,
} from './shapes';
import { SKINS } from './skin';
import { commitInstances } from '../instances';

/**
 * How far each prop kind is drawn, and where it swaps to its far shape:
 * 0 always (summit buildings, bridges), 1 out to the tree distance (houses, boats; near shape
 * within twice propDetail), 2 within smallPropDistance (boulders, buffalo, farmers; near
 * boulders within propDetail).
 */
const RANGE = [1, 1, 1, 0, 0, 0, 1, 1, 2, 2, 2];
/** Per kind: instance capacity. */
const CAP = [1600, 900, 120, 120, 160, 60, 400, 400, 3000, 600, 900];
/** Per kind: casts a sun shadow (high) through near-only proxies. */
const CASTS = [1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0];
/** Per kind: contact-shadow radius at scale 1 (0 = none), laid flat at the record's foot. */
const BLOB = [5.4, 5.4, 7.5, 0, 0, 0, 0, 0, 1.15, 1.7, 0.55];
/** Per kind: the record's y up to the ground at its foot (times its scale). */
const FOOT = [0.2, 0.2, 0.2, 0, 0, 0, 0, 0, 0.18, 0, 0];

const m = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler(0, 0, 0, 'YZX');
const p = new THREE.Vector3();
const sc = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const col = new THREE.Color();
const DAY_LANTERN = new THREE.Color('#b8463b');
// HDR (> 1) so bloom halos the lanterns after dark.
const NIGHT_LANTERN = new THREE.Color(4.2, 1.7, 0.6);

/**
 * Jade River's scenery as global instanced meshes refilled from the live chunks: the pillars
 * in three tiers (hero, mid, far), trees (round, bamboo, pine; smooth-shaded), villages (houses
 * and halls under upturned eaves), summit pavilions and pagodas, stone bridges, fishers' rafts
 * and sampans, scree boulders, vine curtains, water buffalo and farmers, and the paper lanterns
 * that glow on all of them after dark. Buildings and boats swap to far shapes; small things
 * appear within prop distance. Pillars and buildings cast sun shadows on high (near-only
 * proxies); props get contact shadows on medium and high. Refills write into preallocated
 * instance buffers.
 */
export class KarstDecor implements ChunkDecor<KarstChunk> {
  readonly group = new THREE.Group();
  private readonly material: THREE.MeshToonMaterial;
  private readonly rockMaterial: THREE.MeshToonMaterial;
  private readonly lanternMaterial: THREE.MeshBasicMaterial;
  private readonly scatterer: KarstScatter;
  /**
   * Pillar meshes per shape, in three tiers: the finest for the few whose flank is within
   * render.heroDetail (none on low), a mid one out to pillarLod, a coarse one in the haze.
   */
  private readonly heroPillars: THREE.InstancedMesh[];
  private readonly pillars: THREE.InstancedMesh[];
  private readonly farPillars: THREE.InstancedMesh[];
  /** Sun-shadow proxies of the pillars near the bird (high), in the mid shape. */
  private readonly pillarCasters: ShadowCasters[];
  private readonly heroCount = SHAPES.map(() => 0);
  private readonly midCount = SHAPES.map(() => 0);
  private readonly farCount = SHAPES.map(() => 0);
  /** Near (or only) mesh of each prop kind, the far mesh of those that have one. */
  private readonly near: THREE.InstancedMesh[] = [];
  private readonly far: (THREE.InstancedMesh | null)[] = [];
  private readonly casters: (ShadowCasters | null)[] = [];
  private readonly nearCount = new Array<number>(KINDS).fill(0);
  private readonly farCount2 = new Array<number>(KINDS).fill(0);
  private readonly vines: THREE.InstancedMesh;
  private readonly farVines: THREE.InstancedMesh;
  private readonly lanterns: THREE.InstancedMesh;
  private readonly contact = new ContactShadows(3000);
  // Smooth-shaded foliage: the same triangles, but lobes read as rounded paint, not facets.
  readonly trees = new Trees(
    12000,
    [soften(roundTreeGeometry()), soften(bambooGeometry()), soften(pineGeometry())],
    [
      soften(roundTreeDetailGeometry()),
      soften(bambooDetailGeometry()),
      soften(pineDetailGeometry()),
    ],
  );
  private readonly treeLists: number[][] = [];
  // The refill round's centre and ranges (squared).
  private px = 0;
  private pz = 0;
  private range2 = [0, 0, 0];
  private detail2 = [0, 0, 0];
  private nv = 0;
  private nfv = 0;
  private nl = 0;

  constructor(layout: KarstLayout) {
    this.scatterer = new KarstScatter(layout);
    this.trees.ground = (x, z) => layout.height(x, z); // contact shadows lie on the slope
    this.material = withMist(
      new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() }),
    );
    withMist(this.trees.material);
    this.lanternMaterial = new THREE.MeshBasicMaterial({ color: DAY_LANTERN.clone() });
    // The rock carries the terrain's painted detail (strata, dabs of light) and its own
    // limestone (flutes, streaks, ledge moss); houses stay clean.
    this.rockMaterial = withRockDetail(
      withGroundDetail(
        withMist(
          new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() }),
        ),
      ),
    );
    setRockDetail(this.rockMaterial, Config.render.rockDetail > 0);
    const rock = this.rockMaterial;
    const KC = Config.karst;
    this.heroPillars = SKINS.map((sk, i) =>
      this.make(pillarGeometry(sk, KC.pillarSeg, KC.pillarRings), 60, `pillar-hero-${i}`, rock),
    );
    const mid = SKINS.map((sk) => pillarGeometry(sk));
    this.pillars = mid.map((g, i) => this.make(g, 600, `pillar-${i}`, rock));
    this.farPillars = SKINS.map((sk, i) =>
      this.make(pillarGeometry(sk, 9, 11), 1600, `pillar-far-${i}`, rock),
    );
    this.pillarCasters = mid.map((g) => new ShadowCasters(g, rock, 120));
    const near: THREE.BufferGeometry[] = [
      houseGeometry(1),
      houseGeometry(2),
      hallGeometry(),
      pavilionGeometry(),
      pagodaGeometry(),
      bridgeGeometry(5),
      raftGeometry(),
      sampanGeometry(),
      boulderGeometry(3, 1),
      buffaloGeometry(),
      farmerGeometry(),
    ];
    const far: (THREE.BufferGeometry | null)[] = near.map(() => null);
    far[K.House] = houseFarGeometry(1);
    far[K.House2] = houseFarGeometry(2);
    far[K.Hall] = hallFarGeometry();
    far[K.Raft] = raftFarGeometry();
    far[K.Boulder] = boulderGeometry(3, 0);
    const names = [
      'house',
      'house-2storey',
      'hall',
      'pavilion',
      'pagoda',
      'bridge',
      'raft',
      'sampan',
      'boulder',
      'buffalo',
      'farmer',
    ];
    for (let k = 0; k < KINDS; k++) {
      this.near.push(this.make(near[k], CAP[k], names[k]));
      const fg = far[k];
      this.far.push(fg ? this.make(fg, CAP[k], `${names[k]}-far`) : null);
      const caster = CASTS[k]
        ? new ShadowCasters(near[k], this.material, Math.ceil(CAP[k] / 3))
        : null;
      this.casters.push(caster);
      if (caster) this.group.add(caster.mesh);
    }
    this.vines = this.make(vineGeometry(true), 1500, 'vine');
    this.farVines = this.make(vineGeometry(false), 3000, 'vine-far');
    this.lanterns = this.make(lanternGeometry(), 5000, 'lantern', this.lanternMaterial);
    this.group.add(...this.pillarCasters.map((c) => c.mesh), this.trees.group, this.contact.mesh);
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
    mesh.frustumCulled = false; // instances span the whole view
    mesh.name = name; // shows up in scripts/level-shots.mjs's triangle report
    this.group.add(mesh);
    return mesh;
  }

  scatter(ox: number, oz: number, size: number): KarstChunk {
    return this.scatterer.chunk(ox, oz, size);
  }

  private readonly bare = (c: KarstChunk): boolean => !c.props;

  /** Small things scatter lazily, the first time their chunk comes within reach: one a frame. */
  prepare(items: KarstChunk[], px: number, pz: number, budget: number): boolean {
    const R = Config.render;
    if (R.smallPropDistance <= 0) return false;
    const size = Config.world.chunkSize;
    const reach = R.smallPropDistance * 1.6 + size; // the vines' range, the widest
    for (;;) {
      const c = nearestInReach(items, px, pz, reach, this.bare);
      if (!c) return false;
      if (budget-- <= 0) return true;
      this.scatterer.props(c, size);
    }
  }

  rebuild(items: KarstChunk[], px: number, pz: number): void {
    const R = Config.render;
    const size = Config.world.chunkSize;
    // Small things scatter lazily, the first time their chunk comes within reach.
    const vineRange = R.smallPropDistance * 1.6;
    const reach = Math.max(R.smallPropDistance, vineRange) + size;
    const lists = this.treeLists;
    lists.length = 0;
    for (const c of items) {
      lists.push(c.trees);
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
    this.detail2[0] = Infinity;
    this.detail2[1] = (R.propDetail * 2) ** 2;
    this.detail2[2] = R.propDetail ** 2;
    this.nearCount.fill(0);
    this.farCount2.fill(0);
    this.nv = 0;
    this.nfv = 0;
    this.nl = 0;
    for (const c of this.casters) c?.begin(px, pz, size);
    for (const c of this.pillarCasters) c.begin(px, pz, size);
    this.contact.begin(px, pz);
    this.heroCount.fill(0);
    this.midCount.fill(0);
    this.farCount.fill(0);
    const vine2 = vineRange ** 2;
    const vineNear2 = (R.propDetail * 1.5) ** 2;
    for (const c of items) {
      this.placePillars(c);
      this.place(c.built);
      if (c.props) this.place(c.props);
      if (c.vines && vineRange > 0) this.placeVines(c.vines, vine2, vineNear2);
      this.placeLanterns(c.lanterns);
    }
    for (let k = 0; k < KINDS; k++) {
      this.finish(this.near[k], this.nearCount[k]);
      const f = this.far[k];
      if (f) this.finish(f, this.farCount2[k]);
      this.casters[k]?.end();
    }
    for (let s = 0; s < SHAPES.length; s++) {
      this.finish(this.heroPillars[s], this.heroCount[s]);
      this.finish(this.pillars[s], this.midCount[s]);
      this.finish(this.farPillars[s], this.farCount[s]);
      this.pillarCasters[s].end();
    }
    this.finish(this.vines, this.nv);
    this.finish(this.farVines, this.nfv);
    this.finish(this.lanterns, this.nl);
    this.contact.end();
  }

  private finish(mesh: THREE.InstancedMesh, n: number): void {
    commitInstances(mesh, n);
  }

  private placePillars(c: KarstChunk): void {
    const near2 = Config.karst.pillarLod ** 2;
    const hero = Config.render.heroDetail;
    for (const pl of c.pillars) {
      // Distance to the rock's flank, not its axis: a giant's wall is near before its centre.
      const axis = Math.hypot(pl.x - this.px, pl.z - this.pz);
      const sh = pl.shape;
      let mesh: THREE.InstancedMesh;
      let counter: number[];
      if (
        axis - pl.reach < hero &&
        this.heroCount[sh] < this.heroPillars[sh].instanceMatrix.count
      ) {
        mesh = this.heroPillars[sh];
        counter = this.heroCount;
      } else if (axis * axis < near2) {
        mesh = this.pillars[sh];
        counter = this.midCount;
      } else {
        mesh = this.farPillars[sh];
        counter = this.farCount;
      }
      const k = counter[sh];
      if (k >= mesh.instanceMatrix.count) continue;
      q.setFromAxisAngle(up, pl.yaw);
      m.compose(p.set(pl.x, pl.y0, pl.z), q, sc.set(pl.r, pl.r * pl.k, pl.r));
      mesh.setMatrixAt(k, m);
      this.pillarCasters[sh].add(pl.x, pl.z, m);
      // Each pillar a slightly different stone: greyer, greener or warmer.
      const s = pl.seed;
      mesh.setColorAt(
        k,
        col.setRGB(0.9 + s * 0.14, 0.93 + (1 - s) * 0.1, 0.92 + ((s * 7) % 1) * 0.1),
      );
      counter[sh]++;
    }
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
      const counts = useFar ? this.farCount2 : this.nearCount;
      const idx = counts[kind];
      if (idx >= mesh.instanceMatrix.count) continue;
      e.set(0, list[k + 4], list[k + 5]);
      q.setFromEuler(e);
      const s = list[k + 6];
      m.compose(p.set(x, y, z), q, sc.set(s, list[k + 7], list[k + 8]));
      mesh.setMatrixAt(idx, m);
      const t = list[k + 9];
      mesh.setColorAt(idx, col.setRGB(0.92 + t * 0.14, 0.93 + t * 0.08, 0.92 + (1 - t) * 0.1));
      counts[kind] = idx + 1;
      this.casters[kind]?.add(x, z, m);
      if (BLOB[kind] > 0) this.contact.add(x, y + FOOT[kind] * s, z, BLOB[kind] * s, null);
    }
  }

  /** Vines: the record is the instance's own basis (across, foot to top, out of the wall). */
  private placeVines(list: readonly number[], max2: number, near2: number): void {
    for (let k = 0; k < list.length; k += VINE_STRIDE) {
      const x = list[k];
      const z = list[k + 2];
      const d2 = (x - this.px) ** 2 + (z - this.pz) ** 2;
      if (d2 > max2) continue;
      const nearV = d2 < near2;
      const mesh = nearV ? this.vines : this.farVines;
      const idx = nearV ? this.nv : this.nfv;
      if (idx >= mesh.instanceMatrix.count) continue;
      m.set(
        list[k + 3],
        list[k + 6],
        list[k + 9],
        x,
        list[k + 4],
        list[k + 7],
        list[k + 10],
        list[k + 1],
        list[k + 5],
        list[k + 8],
        list[k + 11],
        z,
        0,
        0,
        0,
        1,
      );
      mesh.setMatrixAt(idx, m);
      const t = (((x * 0.37 + z * 0.11) % 1) + 1) % 1;
      mesh.setColorAt(idx, col.setRGB(0.9 + t * 0.2, 0.95 + t * 0.1, 0.85 + (1 - t) * 0.15));
      if (nearV) this.nv++;
      else this.nfv++;
    }
  }

  /** Lanterns of the buildings and boats that are drawn (out to the tree distance). */
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

  /** Lanterns: red paper by day, glowing warm as the light goes. */
  frame(day: DayCycle): void {
    setRockDetail(this.rockMaterial, Config.render.rockDetail > 0);
    const night = smoothstep(0.08, 0.6, day.palette.stars) * Config.karst.lanterns;
    this.lanternMaterial.color.copy(DAY_LANTERN).lerp(NIGHT_LANTERN, night);
  }

  dispose(): void {
    const meshes = [
      ...this.heroPillars,
      ...this.pillars,
      ...this.farPillars,
      ...this.near,
      this.vines,
      this.farVines,
      this.lanterns,
    ];
    for (const f of this.far) if (f) meshes.push(f);
    for (const mesh of meshes) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    for (const c of this.pillarCasters) c.dispose();
    for (const c of this.casters) c?.dispose();
    this.contact.dispose();
    this.material.dispose();
    this.rockMaterial.dispose();
    this.lanternMaterial.dispose();
    this.trees.dispose();
  }
}
