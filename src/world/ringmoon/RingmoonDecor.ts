import * as THREE from 'three';
import { Config } from '../../core/Config';
import { nearestInReach, type ChunkDecor } from '../ChunkManager';
import { ContactShadows } from '../ContactShadows';
import type { DayCycle } from '../DayCycle';
import { withGroundDetail } from '../GroundDetail';
import { withMist } from '../Mist';
import { ShadowCasters } from '../ShadowCasters';
import { getToonGradient } from '../Terrain';
import { Trees } from '../Trees';
import { commitInstances } from '../instances';
import {
  beaconGeometry,
  beaconRingGeometry,
  coilGeometry,
  crystalGeometry,
  landerFarGeometry,
  landerGeometry,
  reedGeometry,
  spireGeometry,
} from './geometry';
import { lifeMaterial, propMaterial, withMoonLight } from './materials';
import {
  PROP_BEACON,
  PROP_CRYSTAL,
  PROP_POD,
  SPIRE_SHAPES,
  type Prop,
  type RingmoonLayout,
  type Spire,
} from './RingmoonLayout';
import { P, PROP_KINDS, PROP_STRIDE, RingmoonScatter } from './RingmoonScatter';
import { withBasalt } from './rock';
import {
  bulbsGeometry,
  fishSchoolGeometry,
  floaterGeometry,
  grazerGeometry,
  habGeometry,
  lampGeometry,
  mastGeometry,
  stepsGeometry,
} from './shapes';

export interface RingmoonChunk {
  ox: number;
  oz: number;
  spires: Spire[];
  /** Plants in the Trees stride: type, x, y, z, scale, rotY, tint. */
  plants: number[];
  /** Landers, beacons and crystal clusters centred in the chunk. */
  props: Prop[];
  /** The explorers' habs, masts and lamps and the floaters (RingmoonScatter records). */
  sites: number[];
  /** Bulbs, steps, fish and grazers, scattered the first time the chunk comes within reach. */
  life: number[] | null;
}

/** Per prop kind: 0 always drawn, 1 within propDistance, 2 within smallPropDistance. */
const RANGE = [1, 1, 1, 1, 1, 2, 1, 0];
/** Per prop kind: instance capacity. */
const CAP = [300, 200, 1600, 2600, 1600, 300, 300, 60];
/** Per prop kind: contact-shadow radius at scale 1 (0 = none). */
const BLOB = [4.6, 1.6, 0, 0.7, 2.2, 0, 0, 0];
/** Bulb hues (multiplied over the bulbs' pale vertex colours, and their glow). */
const BULBS = ['#8ff3e0', '#f4d27a', '#c9a3ff'].map((h) => new THREE.Color(h));
const FLOATERS = ['#ffffff', '#ffd6ec', '#d4fff4'].map((h) => new THREE.Color(h));

const m = new THREE.Matrix4();
const col = new THREE.Color();
const q = new THREE.Quaternion();
const pv = new THREE.Vector3();
const sv = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * A toon material whose vertices turn about the instance's own vertical axis by `spin` (radians,
 * set each frame), so a beacon's rings revolve round its mast with no matrix updates.
 */
function spinning(spin: { value: number }): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSpin = spin;
    const rot = `
  float spA = uSpin + instanceMatrix[3].x * 0.013 + instanceMatrix[3].z * 0.017;
  mat2 spR = mat2(cos(spA), -sin(spA), sin(spA), cos(spA));`;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uSpin;')
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>${rot}\n  objectNormal.xz = spR * objectNormal.xz;`,
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  transformed.xz = spR * transformed.xz;',
      );
  };
  mat.customProgramCacheKey = () => 'spin';
  return withMist(withMoonLight(mat));
}

/**
 * Ringmoon Shallows' scenery as global instanced meshes refilled from the live chunks: basalt
 * spires in three silhouettes (leaning, so each instance carries a shear; painted columns),
 * coil fronds and reed fans (with distant shapes), the alien things (landing pods near and far,
 * crystal clusters, beacon towers with turning rings), the explorers' habs, masts and lit
 * paths, and lazily within prop distance glow bulbs, basalt steps on the terraces, glowing fish,
 * grazers on the hills and floaters drifting overhead (moving in the vertex shader). Spires,
 * pods, habs and beacons cast sun shadows through near-only proxies (high); pods, habs, masts,
 * crystals, beacons, bulbs and steps get contact shadows. Refills write into preallocated
 * buffers.
 */
export class RingmoonDecor implements ChunkDecor<RingmoonChunk> {
  readonly group = new THREE.Group();
  private readonly scatterer: RingmoonScatter;
  private readonly spireMaterial: THREE.MeshToonMaterial;
  private readonly stepMaterial: THREE.MeshToonMaterial;
  private readonly propMat = propMaterial();
  private readonly lifeMat = lifeMaterial();
  private readonly spires: THREE.InstancedMesh[];
  private readonly farSpires: THREE.InstancedMesh[];
  private readonly ringMaterials: THREE.MeshToonMaterial[];
  private readonly spins = [{ value: 0 }, { value: 0 }];
  private readonly landers: THREE.InstancedMesh;
  private readonly farLanders: THREE.InstancedMesh;
  private readonly beacons: THREE.InstancedMesh;
  private readonly rings: THREE.InstancedMesh[];
  private readonly crystals: THREE.InstancedMesh;
  /** Per prop kind its mesh. */
  private readonly kinds: THREE.InstancedMesh[] = [];
  private readonly kindCount = new Array<number>(PROP_KINDS).fill(0);
  private readonly spireCasters: ShadowCasters[];
  private readonly landerCasters: ShadowCasters;
  private readonly habCasters: ShadowCasters;
  private readonly beaconCasters: ShadowCasters;
  private readonly contact = new ContactShadows(2000);
  readonly trees = new Trees(
    9000,
    [coilGeometry(3, 4, 3), reedGeometry(4)],
    [coilGeometry(), reedGeometry()],
    [coilGeometry(1, 2, 3), reedGeometry(2)],
  );
  private readonly plantLists: number[][] = [];
  private px = 0;
  private pz = 0;
  private big2 = 0;
  private small2 = 0;

  constructor(private readonly layout: RingmoonLayout) {
    this.scatterer = new RingmoonScatter(layout);
    const ground = (x: number, z: number) => layout.height(x, z);
    this.trees.ground = ground; // contact shadows lie on the slope
    withMoonLight(withMist(this.trees.material));
    const toon = () =>
      withGroundDetail(
        withMist(
          new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() }),
        ),
      );
    this.spireMaterial = withMoonLight(withBasalt(toon(), 'spire'));
    this.stepMaterial = withMoonLight(withBasalt(toon(), 'steps'));
    const R = Config.ringmoon;
    const mat = this.spireMaterial;
    const nearGeo = SPIRE_SHAPES.map((sh, i) =>
      spireGeometry(sh, 60 + i, R.spireSides, R.spireRings),
    );
    this.spires = nearGeo.map((g, i) => this.make(g, 700, mat, `spire-${i}`));
    this.farSpires = SPIRE_SHAPES.map((sh, i) =>
      this.make(spireGeometry(sh, 60 + i, R.farSides, R.farRings), 2200, mat, `spire-far-${i}`),
    );
    this.spireCasters = nearGeo.map((g) => new ShadowCasters(g, mat, 300));
    this.ringMaterials = this.spins.map((sp) => spinning(sp));
    const lander = landerGeometry();
    this.landers = this.make(lander, 500, this.propMat, 'lander');
    this.farLanders = this.make(landerFarGeometry(), 600, this.propMat, 'lander-far');
    const beacon = beaconGeometry();
    this.beacons = this.make(beacon, 120, this.propMat, 'beacon');
    this.rings = [false, true].map((upper, i) =>
      this.make(beaconRingGeometry(upper), 120, this.ringMaterials[i], `beacon-ring-${i}`),
    );
    this.crystals = this.make(crystalGeometry(), 600, this.propMat, 'crystal');
    const shapes = [
      habGeometry,
      mastGeometry,
      lampGeometry,
      bulbsGeometry,
      stepsGeometry,
      fishSchoolGeometry,
      grazerGeometry,
      floaterGeometry,
    ];
    const names = ['hab', 'mast', 'lamp', 'bulbs', 'steps', 'fish', 'grazer', 'floater'];
    let habGeo: THREE.BufferGeometry | null = null;
    for (let k = 0; k < PROP_KINDS; k++) {
      const g = shapes[k]();
      if (k === P.Hab) habGeo = g;
      const material = g.getAttribute('aAnim')
        ? this.lifeMat
        : k === P.Steps
          ? this.stepMaterial
          : this.propMat;
      this.kinds.push(this.make(g, CAP[k], material, `rm-${names[k]}`));
    }
    this.landerCasters = new ShadowCasters(lander, this.propMat, 200);
    this.habCasters = new ShadowCasters(habGeo!, this.propMat, 120);
    this.beaconCasters = new ShadowCasters(beacon, this.propMat, 40);
    this.group.add(
      ...this.spireCasters.map((c) => c.mesh),
      this.landerCasters.mesh,
      this.habCasters.mesh,
      this.beaconCasters.mesh,
      this.contact.mesh,
      this.trees.group,
    );
  }

  private make(
    geo: THREE.BufferGeometry,
    cap: number,
    mat: THREE.Material,
    name: string,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    mesh.count = 0;
    mesh.frustumCulled = false; // instances span the whole view
    mesh.name = name; // shows up in scripts/level-shots.mjs's triangle report
    this.group.add(mesh);
    return mesh;
  }

  scatter(ox: number, oz: number, size: number): RingmoonChunk {
    const L = this.layout;
    const out: RingmoonChunk = { ox, oz, spires: [], plants: [], props: [], sites: [], life: null };
    const inChunk = (x: number, z: number) => x >= ox && x < ox + size && z >= oz && z < oz + size;
    const C = Config.ringmoon.spireCell;
    for (let j = Math.floor(oz / C); j <= Math.floor((oz + size) / C); j++)
      for (let i = Math.floor(ox / C); i <= Math.floor((ox + size) / C); i++)
        for (const s of L.cell(i, j)) if (inChunk(s.x, s.z)) out.spires.push(s);
    const PC = Config.ringmoon.propCell;
    for (let j = Math.floor(oz / PC); j <= Math.floor((oz + size) / PC); j++)
      for (let i = Math.floor(ox / PC); i <= Math.floor((ox + size) / PC); i++)
        for (const p of L.props(i, j)) if (inChunk(p.x, p.z)) out.props.push(p);
    this.scatterer.plants(ox, oz, size, out.plants);
    this.scatterer.sites(ox, oz, size, out.sites);
    return out;
  }

  private readonly bare = (c: RingmoonChunk): boolean => !c.life;

  /** The life scatters lazily, the first time its chunk comes within reach: one chunk a frame. */
  prepare(items: RingmoonChunk[], px: number, pz: number, budget: number): boolean {
    const R = Config.render;
    if (R.propDistance <= 0) return false;
    const size = Config.world.chunkSize;
    for (;;) {
      const c = nearestInReach(items, px, pz, R.propDistance + size, this.bare);
      if (!c) return false;
      if (budget-- <= 0) return true;
      c.life = [];
      this.scatterer.props(c.ox, c.oz, size, c.life);
    }
  }

  rebuild(items: RingmoonChunk[], px: number, pz: number): void {
    const R = Config.render;
    const size = Config.world.chunkSize;
    this.plantLists.length = 0;
    for (const c of items) this.plantLists.push(c.plants);
    this.trees.rebuild(this.plantLists, px, pz, R.treeDistance);
    this.px = px;
    this.pz = pz;
    this.big2 = R.propDistance ** 2;
    this.small2 = R.smallPropDistance ** 2;
    this.kindCount.fill(0);
    for (const c of this.spireCasters) c.begin(px, pz, size);
    this.landerCasters.begin(px, pz, size);
    this.habCasters.begin(px, pz, size);
    this.beaconCasters.begin(px, pz, size);
    this.contact.begin(px, pz);
    const nc = this.spires.map(() => 0);
    const fc = this.spires.map(() => 0);
    // Low (no prop detail) keeps the finer spires for the nearest only.
    const near2 = (Config.ringmoon.spireLod * (R.propDetail > 0 ? 1 : 0.35)) ** 2;
    const detail2 = R.propDetail ** 2;
    let lc = 0;
    let lf = 0;
    let bc = 0;
    let cc = 0;
    const e = m.elements;
    const ground = this.trees.ground;
    for (const it of items) {
      for (const s of it.spires) {
        const near = (s.x - px) ** 2 + (s.z - pz) ** 2 < near2;
        const mesh = (near ? this.spires : this.farSpires)[s.shape];
        const counter = near ? nc : fc;
        const k = counter[s.shape];
        if (k >= mesh.instanceMatrix.count) continue;
        // Turned by yaw, scaled to radius and height, sheared along the lean (column-major).
        const c = Math.cos(s.yaw) * s.r;
        const n = Math.sin(s.yaw) * s.r;
        e[0] = c;
        e[1] = 0;
        e[2] = -n;
        e[3] = 0;
        e[4] = s.lx * s.h;
        e[5] = s.h;
        e[6] = s.lz * s.h;
        e[7] = 0;
        e[8] = n;
        e[9] = 0;
        e[10] = c;
        e[11] = 0;
        e[12] = s.x;
        e[13] = s.y0;
        e[14] = s.z;
        e[15] = 1;
        mesh.setMatrixAt(k, m);
        // Each spire a slightly different stone: bluer, warmer or greyer.
        const t = s.seed;
        mesh.setColorAt(
          k,
          col.setRGB(0.9 + t * 0.14, 0.92 + ((t * 5) % 1) * 0.08, 0.94 + (1 - t) * 0.1),
        );
        counter[s.shape]++;
        this.spireCasters[s.shape].add(s.x, s.z, m);
      }
      for (const pr of it.props) {
        q.setFromAxisAngle(UP, pr.yaw);
        m.compose(pv.set(pr.x, pr.y0, pr.z), q, sv.set(pr.s, pr.s, pr.s));
        const d2 = (pr.x - px) ** 2 + (pr.z - pz) ** 2;
        if (pr.type === PROP_POD) {
          if (d2 < detail2 && lc < this.landers.instanceMatrix.count)
            this.landers.setMatrixAt(lc++, m);
          else if (lf < this.farLanders.instanceMatrix.count) this.farLanders.setMatrixAt(lf++, m);
          this.landerCasters.add(pr.x, pr.z, m);
          this.contact.add(pr.x, pr.y0 + 0.4, pr.z, 3.6 * pr.s, ground);
        } else if (pr.type === PROP_BEACON && bc < this.beacons.instanceMatrix.count) {
          this.beacons.setMatrixAt(bc, m);
          // The rings turn in the shader; their yaw here only staggers them.
          for (const r of this.rings) r.setMatrixAt(bc, m);
          bc++;
          this.beaconCasters.add(pr.x, pr.z, m);
          this.contact.add(pr.x, pr.y0 + 2, pr.z, 4.5 * pr.s, ground);
        } else if (pr.type === PROP_CRYSTAL && cc < this.crystals.instanceMatrix.count) {
          this.crystals.setMatrixAt(cc++, m);
          this.contact.add(pr.x, pr.y0 + 0.4, pr.z, 2.2 * pr.s, ground);
        }
      }
      this.place(it.sites);
      if (it.life) this.place(it.life);
    }
    for (let i = 0; i < this.spires.length; i++) {
      commitInstances(this.spires[i], nc[i]);
      commitInstances(this.farSpires[i], fc[i]);
    }
    commitInstances(this.landers, lc);
    commitInstances(this.farLanders, lf);
    commitInstances(this.beacons, bc);
    for (const r of this.rings) commitInstances(r, bc);
    commitInstances(this.crystals, cc);
    for (let k = 0; k < PROP_KINDS; k++) commitInstances(this.kinds[k], this.kindCount[k]);
    for (const c of this.spireCasters) c.end();
    this.landerCasters.end();
    this.habCasters.end();
    this.beaconCasters.end();
    this.contact.end();
  }

  /** Instance every record of a chunk list that is in range. */
  private place(list: readonly number[]): void {
    const ground = this.trees.ground;
    for (let k = 0; k < list.length; k += PROP_STRIDE) {
      const kind = list[k];
      const x = list[k + 1];
      const y = list[k + 2];
      const z = list[k + 3];
      const yaw = list[k + 4];
      const s = list[k + 5];
      const t = list[k + 6];
      const d2 = (x - this.px) ** 2 + (z - this.pz) ** 2;
      const range = RANGE[kind];
      if ((range === 1 && d2 > this.big2) || (range === 2 && d2 > this.small2)) continue;
      const mesh = this.kinds[kind];
      const idx = this.kindCount[kind];
      if (idx >= mesh.instanceMatrix.count) continue;
      // Moving things carry no turn: the shader sets their heading round their circle.
      q.setFromAxisAngle(UP, kind >= P.Fish ? 0 : yaw);
      m.compose(pv.set(x, y, z), q, sv.set(s, s, s));
      mesh.setMatrixAt(idx, m);
      if (kind === P.Bulbs) col.copy(BULBS[Math.floor(t * 3) % 3]);
      else if (kind === P.Floater) col.copy(FLOATERS[Math.floor(t * 3) % 3]);
      else col.setRGB(0.94 + t * 0.1, 0.95 + t * 0.06, 0.94 + (1 - t) * 0.08);
      mesh.setColorAt(idx, col);
      this.kindCount[kind] = idx + 1;
      if (kind === P.Hab) this.habCasters.add(x, z, m);
      if (BLOB[kind] > 0) this.contact.add(x, y + 0.1, z, BLOB[kind] * s, ground);
    }
  }

  /** The rings turn, opposite ways at different speeds (the glow is set in ringFrame). */
  frame(_day: DayCycle, time: number): void {
    const R = Config.ringmoon;
    this.spins[0].value = time * R.ringSpin;
    this.spins[1].value = -time * R.ringSpin * 1.4;
  }

  dispose(): void {
    for (const mesh of [
      ...this.spires,
      ...this.farSpires,
      this.landers,
      this.farLanders,
      this.beacons,
      ...this.rings,
      this.crystals,
      ...this.kinds,
    ]) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    for (const c of this.spireCasters) c.dispose();
    this.landerCasters.dispose();
    this.habCasters.dispose();
    this.beaconCasters.dispose();
    this.contact.dispose();
    this.spireMaterial.dispose();
    this.stepMaterial.dispose();
    this.propMat.dispose();
    this.lifeMat.dispose();
    for (const mat of this.ringMaterials) mat.dispose();
    this.trees.dispose();
  }
}
