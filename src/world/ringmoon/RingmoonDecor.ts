import * as THREE from 'three';
import { Config } from '../../core/Config';
import { smoothstep } from '../../core/math';
import type { ChunkDecor } from '../ChunkManager';
import type { DayCycle } from '../DayCycle';
import { withGroundDetail } from '../GroundDetail';
import { withMist } from '../Mist';
import { getToonGradient } from '../Terrain';
import { hash2 } from '../noise';
import { Trees } from '../Trees';
import {
  beaconGeometry,
  beaconRingGeometry,
  beaconTipGeometry,
  coilGeometry,
  crystalGeometry,
  landerGeometry,
  landerGlowGeometry,
  podGeometry,
  reedGeometry,
  spireGeometry,
} from './geometry';
import {
  PROP_BEACON,
  PROP_CRYSTAL,
  PROP_POD,
  SPIRE_SHAPES,
  type Prop,
  type RingmoonLayout,
  type Spire,
} from './RingmoonLayout';

/** Plant types in the shared Trees meshes. */
const COIL = 0;
const REED = 1;

export interface RingmoonChunk {
  spires: Spire[];
  /** Plants in the Trees stride: type, x, y, z, scale, rotY, tint. */
  plants: number[];
  /** Glow pods: x, y, z, scale, hue (0 cyan .. 1 gold). */
  pods: number[];
  /** Landers, beacons and crystal clusters centred in the chunk. */
  props: Prop[];
}

const m = new THREE.Matrix4();
const col = new THREE.Color();
const q = new THREE.Quaternion();
const pv = new THREE.Vector3();
const sv = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const HATCH_DAY = new THREE.Color('#6fd6c6');
// HDR (> 1): hatches, beacon tips and crystals bloom after dark.
const HATCH_NIGHT = new THREE.Color(1.1, 2.6, 2.3);
const TIP_DAY = new THREE.Color('#7fe6d6');
const TIP_NIGHT = new THREE.Color(1.6, 3.6, 3.2);
const CRYSTAL_GLOW = new THREE.Color('#5b3fa0');

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
  return withMist(mat);
}
const POD_CYAN = new THREE.Color('#7fe0d2');
const POD_GOLD = new THREE.Color('#e8c36a');
// HDR (> 1) so bloom halos the pods after dark.
const POD_NIGHT = new THREE.Color(1.9, 2.3, 2.1);

/**
 * Ringmoon Shallows' scenery as global instanced meshes refilled from the live chunks: basalt
 * spires in three silhouettes (leaning, so each instance carries a shear), coil fronds and
 * reed fans on the islets, and glow pods among them that light up after dark.
 */
export class RingmoonDecor implements ChunkDecor<RingmoonChunk> {
  readonly group = new THREE.Group();
  private readonly spireMaterial: THREE.MeshToonMaterial;
  private readonly podMaterial: THREE.MeshBasicMaterial;
  private readonly spires: THREE.InstancedMesh[];
  private readonly farSpires: THREE.InstancedMesh[];
  private readonly pods: THREE.InstancedMesh;
  private readonly propMaterial: THREE.MeshToonMaterial;
  private readonly crystalMaterial: THREE.MeshToonMaterial;
  private readonly hatchMaterial: THREE.MeshBasicMaterial;
  private readonly tipMaterial: THREE.MeshBasicMaterial;
  private readonly ringMaterials: THREE.MeshToonMaterial[];
  private readonly spins = [{ value: 0 }, { value: 0 }];
  private readonly landers: THREE.InstancedMesh;
  private readonly hatches: THREE.InstancedMesh;
  private readonly beacons: THREE.InstancedMesh;
  private readonly rings: THREE.InstancedMesh[];
  private readonly tips: THREE.InstancedMesh;
  private readonly crystals: THREE.InstancedMesh;
  readonly trees = new Trees(
    9000,
    [coilGeometry(3, 4, 3), reedGeometry(4)],
    [coilGeometry(), reedGeometry()],
  );
  private readonly plantLists: number[][] = [];

  constructor(private readonly layout: RingmoonLayout) {
    withMist(this.trees.material);
    this.spireMaterial = withGroundDetail(
      withMist(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() })),
    );
    this.podMaterial = new THREE.MeshBasicMaterial({ color: '#fff' });
    const mat = this.spireMaterial;
    this.spires = SPIRE_SHAPES.map((sh, i) => this.make(spireGeometry(sh, 60 + i), 700, mat));
    this.farSpires = SPIRE_SHAPES.map((sh, i) =>
      this.make(spireGeometry(sh, 60 + i, 6, 9), 2200, mat),
    );
    this.pods = this.make(podGeometry(), 2400, this.podMaterial);
    this.propMaterial = withMist(
      new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() }),
    );
    this.crystalMaterial = withMist(
      new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() }),
    );
    this.hatchMaterial = new THREE.MeshBasicMaterial({ color: HATCH_DAY.clone() });
    this.tipMaterial = new THREE.MeshBasicMaterial({ color: TIP_DAY.clone() });
    this.ringMaterials = this.spins.map((sp) => spinning(sp));
    this.landers = this.make(landerGeometry(), 500, this.propMaterial);
    this.hatches = this.make(landerGlowGeometry(), 500, this.hatchMaterial);
    this.beacons = this.make(beaconGeometry(), 120, this.propMaterial);
    this.rings = [false, true].map((upper, i) =>
      this.make(beaconRingGeometry(upper), 120, this.ringMaterials[i]),
    );
    this.tips = this.make(beaconTipGeometry(), 120, this.tipMaterial);
    this.crystals = this.make(crystalGeometry(), 600, this.crystalMaterial);
    this.landers.name = 'lander';
    this.hatches.name = 'lander-hatch';
    this.beacons.name = 'beacon';
    this.rings.forEach((r, i) => (r.name = `beacon-ring-${i}`));
    this.tips.name = 'beacon-tip';
    this.crystals.name = 'crystal';
    // Names show up in scripts/level-shots.mjs's triangle report.
    this.spires.forEach((r, i) => (r.name = `spire-${i}`));
    this.farSpires.forEach((r, i) => (r.name = `spire-far-${i}`));
    this.pods.name = 'glow-pod';
    this.group.add(
      ...this.spires,
      ...this.farSpires,
      this.pods,
      this.landers,
      this.hatches,
      this.beacons,
      ...this.rings,
      this.tips,
      this.crystals,
      this.trees.group,
    );
  }

  private make(geo: THREE.BufferGeometry, cap: number, mat: THREE.Material): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    mesh.count = 0;
    mesh.frustumCulled = false; // instances span the whole view
    return mesh;
  }

  scatter(ox: number, oz: number, size: number): RingmoonChunk {
    const L = this.layout;
    const seed = L.seed;
    const out: RingmoonChunk = { spires: [], plants: [], pods: [], props: [] };
    const inChunk = (x: number, z: number) => x >= ox && x < ox + size && z >= oz && z < oz + size;
    const C = Config.ringmoon.spireCell;
    for (let j = Math.floor(oz / C); j <= Math.floor((oz + size) / C); j++)
      for (let i = Math.floor(ox / C); i <= Math.floor((ox + size) / C); i++)
        for (const s of L.cell(i, j)) if (inChunk(s.x, s.z)) out.spires.push(s);
    const PC = Config.ringmoon.propCell;
    for (let j = Math.floor(oz / PC); j <= Math.floor((oz + size) / PC); j++)
      for (let i = Math.floor(ox / PC); i <= Math.floor((ox + size) / PC); i++)
        for (const p of L.props(i, j)) if (inChunk(p.x, p.z)) out.props.push(p);
    // The islets: coil fronds in loose groves, reed fans between them, glow pods at their feet.
    const cell = 10;
    for (let j = Math.ceil(oz / cell); j < Math.ceil((oz + size) / cell); j++)
      for (let i = Math.ceil(ox / cell); i < Math.ceil((ox + size) / cell); i++) {
        const x = (i + hash2(i, j, seed + 21)) * cell;
        const z = (j + hash2(i, j, seed + 22)) * cell;
        const y = L.height(x, z);
        if (y < 1.4) continue;
        // Inland the plants thin out, so the hills read as open moss and the counts stay low.
        if (y > 10 && hash2(i, j, seed + 27) < smoothstep(10, 30, y) * 0.6) continue;
        const h = hash2(i, j, seed + 23);
        const rot = hash2(i, j, seed + 25) * Math.PI * 2;
        const tint = hash2(i, j, seed + 26);
        const s = 0.75 + hash2(i, j, seed + 24) * 0.5;
        if (h < 0.4) out.plants.push(COIL, x, y - 0.3, z, s, rot, tint);
        else if (h < 0.7) out.plants.push(REED, x, y - 0.2, z, s, rot, tint);
        else if (h < 0.77) out.pods.push(x, y + 0.5, z, 0.8 + tint * 0.6, tint);
      }
    return out;
  }

  rebuild(items: RingmoonChunk[], px: number, pz: number): void {
    const nc = this.spires.map(() => 0);
    const fc = this.spires.map(() => 0);
    const near2 = Config.ringmoon.spireLod ** 2;
    let pc = 0;
    let lc = 0;
    let bc = 0;
    let cc = 0;
    this.plantLists.length = 0;
    const e = m.elements;
    for (const it of items) {
      this.plantLists.push(it.plants);
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
      }
      for (const pr of it.props) {
        q.setFromAxisAngle(UP, pr.yaw);
        m.compose(pv.set(pr.x, pr.y0, pr.z), q, sv.set(pr.s, pr.s, pr.s));
        if (pr.type === PROP_POD && lc < this.landers.instanceMatrix.count) {
          this.landers.setMatrixAt(lc, m);
          this.hatches.setMatrixAt(lc++, m);
        } else if (pr.type === PROP_BEACON && bc < this.beacons.instanceMatrix.count) {
          this.beacons.setMatrixAt(bc, m);
          // The rings turn in the shader; their yaw here only staggers them.
          for (const r of this.rings) r.setMatrixAt(bc, m);
          this.tips.setMatrixAt(bc++, m);
        } else if (pr.type === PROP_CRYSTAL && cc < this.crystals.instanceMatrix.count) {
          this.crystals.setMatrixAt(cc++, m);
        }
      }
      const P = it.pods;
      for (let i = 0; i < P.length && pc < this.pods.instanceMatrix.count; i += 5) {
        const sz = P[i + 3];
        m.makeScale(sz, sz, sz).setPosition(P[i], P[i + 1], P[i + 2]);
        this.pods.setMatrixAt(pc, m);
        this.pods.setColorAt(pc++, col.copy(POD_CYAN).lerp(POD_GOLD, P[i + 4] > 0.6 ? 1 : 0));
      }
    }
    const counts: [THREE.InstancedMesh, number][] = [
      ...this.spires.map((mesh, i): [THREE.InstancedMesh, number] => [mesh, nc[i]]),
      ...this.farSpires.map((mesh, i): [THREE.InstancedMesh, number] => [mesh, fc[i]]),
      [this.pods, pc],
      [this.landers, lc],
      [this.hatches, lc],
      [this.beacons, bc],
      ...this.rings.map((r): [THREE.InstancedMesh, number] => [r, bc]),
      [this.tips, bc],
      [this.crystals, cc],
    ];
    for (const [mesh, n] of counts) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.trees.rebuild(this.plantLists, px, pz, Config.render.treeDistance);
  }

  /** Glow pods: soft colour by day, a bright halo as the light goes. */
  frame(day: DayCycle, time: number): void {
    const R = Config.ringmoon;
    const night = smoothstep(0.08, 0.6, day.palette.stars) * R.glow;
    this.podMaterial.color.setRGB(1, 1, 1).lerp(POD_NIGHT, night);
    this.hatchMaterial.color.copy(HATCH_DAY).lerp(HATCH_NIGHT, night);
    // The beacons' tips pulse slowly, brightest after dark.
    const pulse = 0.6 + 0.4 * Math.sin(time * 1.7);
    this.tipMaterial.color.copy(TIP_DAY).lerp(TIP_NIGHT, night * pulse);
    this.crystalMaterial.emissive.copy(CRYSTAL_GLOW).multiplyScalar(night * 0.9);
    // The two rings turn opposite ways at different speeds.
    this.spins[0].value = time * R.ringSpin;
    this.spins[1].value = -time * R.ringSpin * 1.4;
  }

  dispose(): void {
    for (const mesh of [
      ...this.spires,
      ...this.farSpires,
      this.pods,
      this.landers,
      this.hatches,
      this.beacons,
      ...this.rings,
      this.tips,
      this.crystals,
    ]) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.spireMaterial.dispose();
    this.podMaterial.dispose();
    this.propMaterial.dispose();
    this.crystalMaterial.dispose();
    this.hatchMaterial.dispose();
    this.tipMaterial.dispose();
    for (const mat of this.ringMaterials) mat.dispose();
    this.trees.dispose();
  }
}
