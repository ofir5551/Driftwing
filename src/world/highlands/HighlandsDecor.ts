import * as THREE from 'three';
import { Config } from '../../core/Config';
import { nearestInReach, type ChunkDecor } from '../ChunkManager';
import { ContactShadows } from '../ContactShadows';
import { hash2 } from '../noise';
import { ShadowCasters } from '../ShadowCasters';
import {
  Trees,
  pineDetailGeometry,
  pineGeometry,
  roundTreeDetailGeometry,
  roundTreeGeometry,
} from '../Trees';
import { P, PROP_KINDS, PROP_STRIDE, type HighlandsLayout } from './HighlandsLayout';
import { HighlandsScatter } from './HighlandsScatter';
import { propMaterial, smokeMaterial } from './materials';
import {
  CHIMNEY,
  SAIL_HUB,
  barnGeometry,
  birchDetailGeometry,
  birchGeometry,
  boatGeometry,
  boulderGeometry,
  bushFarGeometry,
  bushGeometry,
  cottageGeometry,
  fenceGeometry,
  flockBirdGeometry,
  haybaleGeometry,
  logGeometry,
  reedsGeometry,
  sailsGeometry,
  sheepGeometry,
  slabGeometry,
  wallGeometry,
  windmillGeometry,
} from './shapes';
import { commitInstances } from '../instances';

/** One terrain chunk's Highlands scenery. */
export interface HighlandsChunk {
  ox: number;
  oz: number;
  /** Forest scatter (Trees' TREE_STRIDE records). */
  trees: number[];
  /** Buildings (the layout's cached list: also the flight floor's). */
  built: readonly number[];
  /** Small scenery, scattered the first time the chunk comes within prop distance. */
  props: number[] | null;
  /** Hedgerow trees at field corners (with the props). */
  hedge: number[];
}

/** Per kind: drawn only within smallPropDistance. */
const SMALL = [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1];
/** Per kind: instance capacity. */
const CAP = [500, 300, 60, 60, 3000, 900, 4000, 600, 2500, 7000, 4000, 3000, 200, 3000, 1200];
/** Per kind: casts a sun shadow (through near-only proxies). */
const CASTS = [1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0];
/** Per kind: contact-shadow radius at scale 1 (0 = none). */
const BLOB = [5.2, 7, 3.8, 0, 1.6, 1.8, 1.6, 0, 1.3, 0, 0, 1, 0, 0, 0];
/** Per kind: from the record's y to the ground at its foot (absolute, and times its scale). */
const FOOT = [0.25, 0.3, 0.25, 0, 0, 0, 0.15, 0, 0, 0, 0, 0, 0, 0, 0];
const FOOT_S = [0, 0, 0, 0, 0.25, 0.25, 0, 0, 0, 0, 0, 0, 0, 0, 0];
/** Smoke puffs per chimney (staggered up the column by phase). */
const PUFFS = 7;

const m = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler(0, 0, 0, 'YZX');
const p = new THREE.Vector3();
const sc = new THREE.Vector3();
const v3 = new THREE.Vector3();
const col = new THREE.Color();

/**
 * The Highlands' scenery as instanced meshes: forests (three species, near and far shapes),
 * buildings (cottages, barns, windmills with turning sails, chimney smoke) and the small things
 * of a lived-in land (rocks, bushes, logs, walls, fences, hay, sheep, reeds, boats, flocks).
 * Bushes and boulders swap to cheap far shapes beyond render.propDetail. Big props cast sun
 * shadows through near-only proxies; trees and props get contact shadows. Refilled whenever the
 * chunk set changes, writing into preallocated buffers (no allocation per refill).
 */
export class HighlandsDecor implements ChunkDecor<HighlandsChunk> {
  readonly group = new THREE.Group();
  readonly trees = new Trees(
    9000,
    [roundTreeGeometry(), pineGeometry(), birchGeometry()],
    [roundTreeDetailGeometry(), pineDetailGeometry(), birchDetailGeometry()],
  );
  readonly material = propMaterial();
  readonly smokeMaterial = smokeMaterial();
  private readonly scatterer: HighlandsScatter;
  /** Near (or only) mesh of each kind, and the far mesh of the kinds that have one. */
  private readonly near: THREE.InstancedMesh[] = [];
  private readonly far: (THREE.InstancedMesh | null)[] = [];
  private readonly casters: (ShadowCasters | null)[] = [];
  private readonly contact = new ContactShadows(6000);
  private readonly smoke: THREE.InstancedMesh;
  private readonly smokePhase: THREE.InstancedBufferAttribute;
  private readonly nearCount = new Array<number>(PROP_KINDS).fill(0);
  private readonly farCount = new Array<number>(PROP_KINDS).fill(0);
  private readonly treeLists: number[][] = [];
  private smokeCount = 0;
  // The refill round's centre and ranges (squared).
  private px = 0;
  private pz = 0;
  private big2 = 0;
  private small2 = 0;
  private detail2 = 0;
  private smoke2 = 0;

  constructor(private readonly layout: HighlandsLayout) {
    this.scatterer = new HighlandsScatter(layout);
    this.trees.ground = (x, z) => layout.field.height(x, z);
    const near = [
      cottageGeometry(),
      barnGeometry(),
      windmillGeometry(),
      sailsGeometry(),
      boulderGeometry(3, 1),
      slabGeometry(5),
      bushGeometry(),
      logGeometry(),
      haybaleGeometry(),
      wallGeometry(),
      fenceGeometry(),
      sheepGeometry(),
      boatGeometry(),
      reedsGeometry(),
      flockBirdGeometry(),
    ];
    const far: (THREE.BufferGeometry | null)[] = near.map(() => null);
    far[P.Boulder] = boulderGeometry(3, 0);
    far[P.Bush] = bushFarGeometry();
    for (let k = 0; k < PROP_KINDS; k++) {
      this.near.push(this.make(near[k], CAP[k], `hl-${k}`));
      const fg = far[k];
      this.far.push(fg ? this.make(fg, CAP[k], `hl-${k}-far`) : null);
      const caster = CASTS[k] ? new ShadowCasters(near[k], this.material, CAP[k]) : null;
      this.casters.push(caster);
      if (caster) this.group.add(caster.mesh);
    }
    const puff = new THREE.PlaneGeometry(1, 1);
    const cap = 200 * PUFFS;
    this.smokePhase = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    puff.setAttribute('aPhase', this.smokePhase);
    this.smoke = new THREE.InstancedMesh(puff, this.smokeMaterial, cap);
    this.smoke.count = 0;
    this.smoke.frustumCulled = false;
    this.smoke.renderOrder = 2; // transparent, after the ground and the contact shadows
    this.smoke.name = 'hl-smoke';
    this.group.add(this.trees.group, this.contact.mesh, this.smoke);
  }

  private make(g: THREE.BufferGeometry, cap: number, name: string): THREE.InstancedMesh {
    if (!g.getAttribute('aAnim'))
      g.setAttribute(
        'aAnim',
        new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2),
      );
    const mesh = new THREE.InstancedMesh(g, this.material, cap);
    mesh.count = 0;
    mesh.frustumCulled = false; // instances span the view
    mesh.name = name;
    mesh.setColorAt(0, col.set('#fff'));
    this.group.add(mesh);
    return mesh;
  }

  scatter(ox: number, oz: number, size: number): HighlandsChunk {
    const built = this.layout.built(Math.round(ox / size), Math.round(oz / size));
    const trees: number[] = [];
    this.scatterer.trees(ox, oz, size, built, trees);
    return { ox, oz, trees, built, props: null, hedge: [] };
  }

  private readonly bare = (c: HighlandsChunk): boolean => !c.props;

  /** Props scatter lazily, the first time their chunk comes within reach: one chunk a frame. */
  prepare(items: HighlandsChunk[], px: number, pz: number, budget: number): boolean {
    const R = Config.render;
    if (R.propDistance <= 0) return false;
    const size = Config.world.chunkSize;
    for (;;) {
      const c = nearestInReach(items, px, pz, R.propDistance + size, this.bare);
      if (!c) return false;
      if (budget-- <= 0) return true;
      c.props = [];
      this.scatterer.props(c.ox, c.oz, size, c.built, c.props, c.hedge);
    }
  }

  rebuild(items: HighlandsChunk[], px: number, pz: number): void {
    const R = Config.render;
    const size = Config.world.chunkSize;
    const lists = this.treeLists;
    lists.length = 0;
    for (const c of items) {
      lists.push(c.trees);
      if (c.props) lists.push(c.hedge);
    }
    this.trees.rebuild(lists, px, pz, R.treeDistance);

    this.px = px;
    this.pz = pz;
    this.big2 = R.propDistance ** 2;
    this.small2 = R.smallPropDistance ** 2;
    this.detail2 = R.propDetail ** 2;
    this.smoke2 = Math.min(R.propDistance, 450) ** 2;
    this.nearCount.fill(0);
    this.farCount.fill(0);
    this.smokeCount = 0;
    for (const c of this.casters) c?.begin(px, pz, size);
    this.contact.begin(px, pz);
    for (const c of items) {
      this.place(c.built);
      if (c.props) this.place(c.props);
    }
    for (let k = 0; k < PROP_KINDS; k++) {
      this.finish(this.near[k], this.nearCount[k]);
      const f = this.far[k];
      if (f) this.finish(f, this.farCount[k]);
      this.casters[k]?.end();
    }
    this.contact.end();
    commitInstances(this.smoke, this.smokeCount);
    this.smokePhase.needsUpdate = true;
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
      if (d2 > (SMALL[kind] ? this.small2 : this.big2)) continue;
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
      mesh.setColorAt(idx, col.setRGB(0.9 + t * 0.16, 0.92 + t * 0.1, 0.92 + (1 - t) * 0.12));
      counts[kind] = idx + 1;
      this.casters[kind]?.add(x, z, m);
      if (BLOB[kind] > 0)
        this.contact.add(x, y + FOOT[kind] + FOOT_S[kind] * s, z, BLOB[kind] * s, null);
      if (kind === P.Windmill) this.placeSails(x, z);
      else if (kind === P.Cottage && d2 < this.smoke2) this.placeSmoke(x, y, z);
    }
  }

  /** The windmill's sails ride its cap, facing its front (q, p hold the windmill's pose). */
  private placeSails(x: number, z: number): void {
    const n = this.nearCount[P.Sails];
    if (n >= CAP[P.Sails]) return;
    v3.copy(SAIL_HUB).applyQuaternion(q).add(p);
    m.compose(v3, q, sc.set(1, 1, 1));
    this.near[P.Sails].setMatrixAt(n, m);
    this.near[P.Sails].setColorAt(n, col.set('#fff'));
    this.nearCount[P.Sails] = n + 1;
    this.casters[P.Sails]?.add(x, z, m);
  }

  /** A column of smoke puffs from the cottage's chimney (q holds the cottage's turn). */
  private placeSmoke(x: number, y: number, z: number): void {
    if (this.smokeCount + PUFFS > this.smokePhase.count) return;
    v3.copy(CHIMNEY).applyQuaternion(q);
    const h = hash2(Math.round(x), Math.round(z), 77);
    m.makeTranslation(x + v3.x, y + v3.y, z + v3.z);
    for (let s = 0; s < PUFFS; s++) {
      this.smoke.setMatrixAt(this.smokeCount, m);
      this.smokePhase.setX(this.smokeCount, s / PUFFS + h);
      this.smokeCount++;
    }
  }

  dispose(): void {
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
    this.smoke.geometry.dispose();
    this.smoke.dispose();
    this.material.dispose();
    this.smokeMaterial.dispose();
  }
}
