import * as THREE from 'three';
import { Config } from '../../core/Config';
import { smoothstep } from '../../core/math';
import type { ChunkDecor } from '../ChunkManager';
import type { DayCycle } from '../DayCycle';
import { withMist } from '../Mist';
import { mulberry32 } from '../noise';
import { getToonGradient } from '../Terrain';
import { Trees } from '../Trees';
import {
  cloudPineDetailGeometry,
  cloudPineGeometry,
  HERMITAGE_LANTERNS,
  hermitageGeometry,
  MONASTERY_LANTERNS,
  monasteryGeometry,
  spireGeometry,
} from './geometry';
import { profile, SHAPES, Temple, type PeaksLayout, type Spire } from './PeaksLayout';

const PINE = 0;

export interface PeaksChunk {
  spires: Spire[];
  /** Trees in the Trees stride: type, x, y, z, scale, rotY, tint. */
  trees: number[];
  /** x, y, z, yaw, kind (Temple) */
  temples: number[];
  /** x, y, z, scale */
  lanterns: number[];
}

const m = new THREE.Matrix4();
const q = new THREE.Quaternion();
const p = new THREE.Vector3();
const sc = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const col = new THREE.Color();
const DAY_LANTERN = new THREE.Color('#b8463b');
// HDR (> 1) so bloom halos the lanterns after dark.
const NIGHT_LANTERN = new THREE.Color(4.4, 1.9, 0.7);

/** Push local point l of a thing at (x, y, z) turned by yaw, plus a size, into `out`. */
function place(
  out: number[],
  x: number,
  y: number,
  z: number,
  yaw: number,
  l: { x: number; y: number; z: number },
  size: number,
): void {
  const c = Math.cos(yaw);
  const n = Math.sin(yaw);
  out.push(x + l.x * c + l.z * n, y + l.y, z - l.x * n + l.z * c, size);
}

/**
 * Sea of Clouds' scenery as global instanced meshes refilled from the live chunks: five spire
 * silhouettes (a faceted near mesh and a coarse far one), granite pines on the summits and
 * reaching out from the cliffs, hermitages and the gate's monastery, and their lanterns.
 */
export class PeaksDecor implements ChunkDecor<PeaksChunk> {
  readonly group = new THREE.Group();
  private readonly material: THREE.MeshToonMaterial;
  private readonly rockMaterial: THREE.MeshToonMaterial;
  readonly lanternMaterial: THREE.MeshBasicMaterial;
  private readonly spires: THREE.InstancedMesh[];
  private readonly farSpires: THREE.InstancedMesh[];
  private readonly hermitages: THREE.InstancedMesh;
  private readonly monastery: THREE.InstancedMesh;
  private readonly lanterns: THREE.InstancedMesh;
  readonly trees = new Trees(9000, [cloudPineGeometry()], [cloudPineDetailGeometry()]);
  private readonly treeLists: number[][] = [];

  constructor(private readonly layout: PeaksLayout) {
    this.material = withMist(
      new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() }),
    );
    withMist(this.trees.material);
    this.lanternMaterial = new THREE.MeshBasicMaterial({ color: DAY_LANTERN.clone() });
    this.rockMaterial = withMist(
      new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() }),
    );
    const rock = this.rockMaterial;
    this.spires = SHAPES.map((sh, i) => this.make(spireGeometry(sh, 90 + i), 600, rock));
    this.farSpires = SHAPES.map((sh, i) => this.make(spireGeometry(sh, 90 + i, 6, 10), 1600, rock));
    this.hermitages = this.make(hermitageGeometry(), 200);
    this.monastery = this.make(monasteryGeometry(), 4);
    this.lanterns = this.make(
      new THREE.SphereGeometry(0.5, 8, 6).scale(1, 1.25, 1),
      2000,
      this.lanternMaterial,
    );
    // Names show up in scripts/level-shots.mjs's triangle report.
    this.spires.forEach((mesh, i) => (mesh.name = `spire-${i}`));
    this.farSpires.forEach((mesh, i) => (mesh.name = `spire-far-${i}`));
    this.hermitages.name = 'hermitage';
    this.monastery.name = 'monastery';
    this.lanterns.name = 'lantern';
    this.group.add(
      ...this.spires,
      ...this.farSpires,
      this.hermitages,
      this.monastery,
      this.lanterns,
      this.trees.group,
    );
  }

  private make(
    geo: THREE.BufferGeometry,
    cap: number,
    mat: THREE.Material = this.material,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    mesh.count = 0;
    mesh.frustumCulled = false; // instances span the whole view
    return mesh;
  }

  scatter(ox: number, oz: number, size: number): PeaksChunk {
    const L = this.layout;
    const out: PeaksChunk = { spires: [], trees: [], temples: [], lanterns: [] };
    const C = Config.peaks.spireCell;
    for (let j = Math.floor(oz / C); j <= Math.floor((oz + size) / C); j++)
      for (let i = Math.floor(ox / C); i <= Math.floor((ox + size) / C); i++)
        for (const sp of L.cell(i, j)) {
          if (sp.x < ox || sp.x >= ox + size || sp.z < oz || sp.z >= oz + size) continue;
          out.spires.push(sp);
          this.dress(sp, out);
        }
    return out;
  }

  /** A spire's pines on the summit and ledges, cliff pines reaching out, and maybe a temple. */
  private dress(sp: Spire, out: PeaksChunk): void {
    const sh = SHAPES[sp.shape];
    const rand = mulberry32(Math.floor(sp.seed * 1e9) + 7);
    /** A pine at fraction t up the rock, angle a round it, set `inset` into the face. */
    const at = (t: number, a: number, inset: number, s: number, outward: boolean) => {
      const r = sp.r * profile(sh, t) * inset;
      out.trees.push(
        PINE,
        sp.x + sp.lx * t * t + Math.sin(a) * r,
        sp.y0 + t * sp.h - 0.5,
        sp.z + sp.lz * t * t + Math.cos(a) * r,
        s,
        // The drawn pine leans toward local +x: on a cliff, point that away from the rock.
        outward ? a - Math.PI / 2 + (rand() - 0.5) * 0.6 : rand() * Math.PI * 2,
        rand(),
      );
    };
    // Summit pines; a temple keeps the middle of the top for itself.
    const span = sp.temple === Temple.None ? 0.9 : 0.35;
    const crown = 4 + Math.floor(sp.r / 5);
    for (let k = 0; k < crown; k++) {
      const t = sh.cap + (1 - sh.cap) * span * rand();
      const a = rand() * Math.PI * 2;
      at(
        t,
        a,
        sp.temple === Temple.None ? 0.85 * rand() + 0.1 : 0.9,
        1.2 + rand() * 0.8,
        t < sh.cap + 0.04,
      );
    }
    // Ledges where the tiers step in.
    for (let tier = 1; tier <= sh.tiers; tier++) {
      const t = tier / (sh.tiers + 1) + 0.005;
      if (t < 0.2) continue;
      for (let k = 0; k < 3; k++) at(t, rand() * Math.PI * 2, 0.95, 1.1 + rand() * 0.5, true);
    }
    // Cliff pines clinging to the walls above the cloud sea, reaching out over the drop.
    const cloudT = (Config.peaks.cloud + 15 - sp.y0) / sp.h;
    const cliffs = Math.floor(sp.h / 35);
    for (let k = 0; k < cliffs; k++) {
      const t = cloudT + (sh.cap - 0.05 - cloudT) * rand();
      if (t > cloudT) at(t, rand() * Math.PI * 2, 0.97, 0.9 + rand() * 0.5, true);
    }
    if (sp.temple !== Temple.None) {
      const t = 0.985;
      const x = sp.x + sp.lx * t * t;
      const y = sp.y0 + sp.h * t - 0.6;
      const z = sp.z + sp.lz * t * t;
      out.temples.push(x, y, z, sp.yaw, sp.temple);
      const lamps = sp.temple === Temple.Monastery ? MONASTERY_LANTERNS : HERMITAGE_LANTERNS;
      for (const l of lamps) place(out.lanterns, x, y, z, sp.yaw, l, 1.1);
    }
  }

  rebuild(items: PeaksChunk[], px: number, pz: number): void {
    const pc = this.spires.map(() => 0);
    const fc = this.spires.map(() => 0);
    const near2 = Config.peaks.spireLod ** 2;
    let hc = 0;
    let mc = 0;
    let lc = 0;
    this.treeLists.length = 0;
    for (const it of items) {
      this.treeLists.push(it.trees);
      for (const sp of it.spires) {
        const near = (sp.x - px) ** 2 + (sp.z - pz) ** 2 < near2;
        const mesh = (near ? this.spires : this.farSpires)[sp.shape];
        const counter = near ? pc : fc;
        const k = counter[sp.shape];
        if (k >= mesh.instanceMatrix.count) continue;
        q.setFromAxisAngle(up, sp.yaw);
        m.compose(p.set(sp.x, sp.y0, sp.z), q, sc.set(sp.r, sp.r * sp.k, sp.r));
        mesh.setMatrixAt(k, m);
        // Each spire a slightly different granite: warmer, cooler or paler.
        const s = sp.seed;
        mesh.setColorAt(
          k,
          col.setRGB(0.92 + s * 0.12, 0.92 + ((s * 5) % 1) * 0.08, 0.9 + (1 - s) * 0.12),
        );
        counter[sp.shape]++;
      }
      const T = it.temples;
      for (let i = 0; i < T.length; i += 5) {
        const mesh = T[i + 4] === Temple.Monastery ? this.monastery : this.hermitages;
        const k = mesh === this.monastery ? mc : hc;
        if (k >= mesh.instanceMatrix.count) continue;
        q.setFromAxisAngle(up, T[i + 3]);
        m.compose(p.set(T[i], T[i + 1], T[i + 2]), q, sc.set(1, 1, 1));
        mesh.setMatrixAt(k, m);
        if (mesh === this.monastery) mc++;
        else hc++;
      }
      const N = it.lanterns;
      for (let i = 0; i < N.length && lc < this.lanterns.instanceMatrix.count; i += 4) {
        const s = N[i + 3];
        m.makeScale(s, s, s).setPosition(N[i], N[i + 1], N[i + 2]);
        this.lanterns.setMatrixAt(lc++, m);
      }
    }
    const counts: [THREE.InstancedMesh, number][] = [
      ...this.spires.map((mesh, i): [THREE.InstancedMesh, number] => [mesh, pc[i]]),
      ...this.farSpires.map((mesh, i): [THREE.InstancedMesh, number] => [mesh, fc[i]]),
      [this.hermitages, hc],
      [this.monastery, mc],
      [this.lanterns, lc],
    ];
    for (const [mesh, n] of counts) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.trees.rebuild(this.treeLists, px, pz, Config.render.treeDistance);
  }

  /** Lanterns: red paper by day, glowing warm as the light goes. */
  frame(day: DayCycle): void {
    const night = smoothstep(0.08, 0.6, day.palette.stars) * Config.peaks.lanterns;
    this.lanternMaterial.color.copy(DAY_LANTERN).lerp(NIGHT_LANTERN, night);
  }

  dispose(): void {
    for (const mesh of [
      ...this.spires,
      ...this.farSpires,
      this.hermitages,
      this.monastery,
      this.lanterns,
    ]) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.material.dispose();
    this.rockMaterial.dispose();
    this.lanternMaterial.dispose();
    this.trees.dispose();
  }
}
