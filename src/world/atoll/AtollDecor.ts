import * as THREE from 'three';
import { Config } from '../../core/Config';
import { smoothstep } from '../../core/math';
import type { ChunkDecor } from '../ChunkManager';
import type { DayCycle } from '../DayCycle';
import { withGroundDetail } from '../GroundDetail';
import { withMist } from '../Mist';
import { getToonGradient } from '../Terrain';
import { hash2 } from '../noise';
import { roundTreeDetailGeometry, roundTreeGeometry, Trees } from '../Trees';
import { DECK_Y, ROCK_SHAPES, type AtollLayout, type Rock } from './AtollLayout';
import {
  bungalowGeometry,
  bungalowWindowsGeometry,
  canoeGeometry,
  DECK_LANTERN,
  deckGeometry,
  lanternGeometry,
  palmDetailGeometry,
  palmGeometry,
  rockGeometry,
  SAIL_LANTERN,
  sailboatGeometry,
  shrubGeometry,
} from './geometry';

/** Tree types in the shared Trees meshes. */
const PALM = 0;
const SHRUB = 1;
const JUNGLE = 2;

export interface AtollChunk {
  rocks: Rock[];
  /** Trees in the Trees stride: type, x, y, z, scale, rotY, tint. */
  trees: number[];
  /** x, z, yaw */
  bungalows: number[];
  /** x, z, yaw, length */
  decks: number[];
  /** type (0 sailboat, 1 canoe), x, z, yaw */
  boats: number[];
  /** x, y, z, scale */
  lanterns: number[];
}

const m = new THREE.Matrix4();
const q = new THREE.Quaternion();
const p = new THREE.Vector3();
const sc = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const col = new THREE.Color();
const DAY_PANE = new THREE.Color('#3a3027');
// HDR (> 1) so bloom halos the windows and lanterns after dark.
const NIGHT_PANE = new THREE.Color(3.6, 2.1, 0.9);
const DAY_LANTERN = new THREE.Color('#e0b25a');
const NIGHT_LANTERN = new THREE.Color(4.4, 2.4, 0.9);

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
 * Coral Atolls' scenery as global instanced meshes refilled from the live chunks: mushroom
 * rocks in four silhouettes, coconut palms and shrubs on the islets and coasts, jungle up the
 * high islands, the bungalows and deck of every pier, boats moored on the lagoons, and the
 * windows and lanterns that glow on them after dark.
 */
export class AtollDecor implements ChunkDecor<AtollChunk> {
  readonly group = new THREE.Group();
  private readonly material: THREE.MeshToonMaterial;
  private readonly rockMaterial: THREE.MeshToonMaterial;
  private readonly paneMaterial: THREE.MeshBasicMaterial;
  private readonly lanternMaterial: THREE.MeshBasicMaterial;
  /** Rock meshes: per shape, a detailed one near the bird and a coarse one in the haze. */
  private readonly rocks: THREE.InstancedMesh[];
  private readonly farRocks: THREE.InstancedMesh[];
  private readonly bungalows: THREE.InstancedMesh;
  private readonly panes: THREE.InstancedMesh;
  private readonly decks: THREE.InstancedMesh;
  private readonly boats: THREE.InstancedMesh[];
  private readonly lanterns: THREE.InstancedMesh;
  readonly trees = new Trees(
    10000,
    [palmGeometry(), shrubGeometry(), roundTreeGeometry()],
    [palmDetailGeometry(), undefined, roundTreeDetailGeometry()],
  );
  private readonly treeLists: number[][] = [];

  constructor(private readonly layout: AtollLayout) {
    this.material = withMist(
      new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() }),
    );
    withMist(this.trees.material);
    this.rockMaterial = withGroundDetail(
      withMist(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() })),
    );
    this.paneMaterial = new THREE.MeshBasicMaterial({ color: DAY_PANE.clone() });
    this.lanternMaterial = new THREE.MeshBasicMaterial({ color: DAY_LANTERN.clone() });
    const rock = this.rockMaterial;
    this.rocks = ROCK_SHAPES.map((sh, i) => this.make(rockGeometry(sh, 90 + i), 500, rock));
    this.farRocks = ROCK_SHAPES.map((sh, i) =>
      this.make(rockGeometry(sh, 90 + i, 8, 9), 1400, rock),
    );
    this.bungalows = this.make(bungalowGeometry(), 600);
    this.panes = this.make(bungalowWindowsGeometry(), 600, this.paneMaterial);
    this.decks = this.make(deckGeometry(), 800);
    this.boats = [this.make(sailboatGeometry(), 400), this.make(canoeGeometry(), 400)];
    this.lanterns = this.make(lanternGeometry(), 1600, this.lanternMaterial);
    // Names show up in scripts/level-shots.mjs's triangle report.
    this.rocks.forEach((r, i) => (r.name = `rock-${i}`));
    this.farRocks.forEach((r, i) => (r.name = `rock-far-${i}`));
    this.bungalows.name = 'bungalow';
    this.panes.name = 'bungalow-pane';
    this.decks.name = 'deck';
    this.boats[0].name = 'sailboat';
    this.boats[1].name = 'canoe';
    this.lanterns.name = 'lantern';
    this.group.add(
      ...this.rocks,
      ...this.farRocks,
      this.bungalows,
      this.panes,
      this.decks,
      ...this.boats,
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

  scatter(ox: number, oz: number, size: number): AtollChunk {
    const L = this.layout;
    const seed = L.seed;
    const out: AtollChunk = {
      rocks: [],
      trees: [],
      bungalows: [],
      decks: [],
      boats: [],
      lanterns: [],
    };
    const inChunk = (x: number, z: number) => x >= ox && x < ox + size && z >= oz && z < oz + size;
    // Rocks whose centre lies in this chunk.
    const RC = Config.atoll.rockCell;
    for (let j = Math.floor(oz / RC); j <= Math.floor((oz + size) / RC); j++)
      for (let i = Math.floor(ox / RC); i <= Math.floor((ox + size) / RC); i++)
        for (const r of L.cell(i, j)) if (inChunk(r.x, r.z)) out.rocks.push(r);
    // Piers of any atoll that reaches this chunk: the runs and bungalows that stand in it.
    const AC = Config.atoll.cell;
    for (let j = Math.round((oz - 700) / AC); j <= Math.round((oz + size + 700) / AC); j++)
      for (let i = Math.round((ox - 700) / AC); i <= Math.round((ox + size + 700) / AC); i++) {
        const a = L.atoll(i, j);
        if (!a) continue;
        const D = a.deck;
        for (let k = 0; k < D.length; k += 4) {
          if (!inChunk(D[k], D[k + 1])) continue;
          out.decks.push(D[k], D[k + 1], D[k + 2], D[k + 3]);
          if ((k / 4) % 3 === 1) place(out.lanterns, D[k], 0, D[k + 1], D[k + 2], DECK_LANTERN, 1);
        }
        const B = a.bungalows;
        for (let k = 0; k < B.length; k += 3)
          if (inChunk(B[k], B[k + 1])) out.bungalows.push(B[k], B[k + 1], B[k + 2]);
      }
    // Islets and coasts: palms with shrubs between them; jungle up the high islands.
    const cell = 6.5;
    for (let j = Math.ceil(oz / cell); j < Math.ceil((oz + size) / cell); j++)
      for (let i = Math.ceil(ox / cell); i < Math.ceil((ox + size) / cell); i++) {
        const x = (i + hash2(i, j, seed + 11)) * cell;
        const z = (j + hash2(i, j, seed + 12)) * cell;
        const y = L.height(x, z);
        if (y < 0.9) continue;
        const h = hash2(i, j, seed + 13);
        const rot = hash2(i, j, seed + 15) * Math.PI * 2;
        const tint = hash2(i, j, seed + 16);
        if (y < 5.5) {
          if (h < 0.5)
            out.trees.push(PALM, x, y - 0.2, z, 0.8 + hash2(i, j, seed + 14) * 0.45, rot, tint);
          else if (h < 0.72) out.trees.push(SHRUB, x, y - 0.3, z, 0.7 + tint * 0.6, rot, tint);
          continue;
        }
        // On the island: jungle, thinning out on the cliffs (about every other cell, so the
        // crowns are big and few rather than a carpet of small ones).
        if (h > 0.45) continue;
        const slope = Math.abs(L.height(x + 2, z) - y) + Math.abs(L.height(x, z + 2) - y);
        if (slope > 3.2) continue;
        out.trees.push(JUNGLE, x, y - 0.5, z, 1.1 + hash2(i, j, seed + 14) * 0.6, rot, tint);
      }
    // Boats moored on the lagoons, clear of the rocks and the spawn's opening run.
    const bc = 120;
    for (let j = Math.ceil(oz / bc); j < Math.ceil((oz + size) / bc); j++)
      for (let i = Math.ceil(ox / bc); i < Math.ceil((ox + size) / bc); i++) {
        if (hash2(i, j, seed + 31) > 0.35) continue;
        const x = (i + hash2(i, j, seed + 32)) * bc;
        const z = (j + hash2(i, j, seed + 33)) * bc;
        L.ring(x, z);
        const a = L.ra;
        if (!a || L.rs > -a.w - 25 || L.height(x, z) > -1.5) continue;
        if (L.skyline(x, z, 18) !== -Infinity || L.nearOpening(x, z, 30)) continue;
        if (a.island && Math.hypot(x - a.island.x, z - a.island.z) < a.island.r * 1.35) continue;
        const type = hash2(i, j, seed + 34) < 0.6 ? 0 : 1;
        const yaw = hash2(i, j, seed + 35) * Math.PI * 2;
        out.boats.push(type, x, z, yaw);
        if (type === 0) place(out.lanterns, x, 0, z, yaw, SAIL_LANTERN, 0.9);
      }
    return out;
  }

  rebuild(items: AtollChunk[], px: number, pz: number): void {
    const rc = this.rocks.map(() => 0);
    const fc = this.rocks.map(() => 0);
    const near2 = Config.atoll.rockLod ** 2;
    let bc = 0;
    let dc = 0;
    let lc = 0;
    const boatC = [0, 0];
    this.treeLists.length = 0;
    for (const it of items) {
      this.treeLists.push(it.trees);
      for (const r of it.rocks) {
        const near = (r.x - px) ** 2 + (r.z - pz) ** 2 < near2;
        const mesh = (near ? this.rocks : this.farRocks)[r.shape];
        const counter = near ? rc : fc;
        const k = counter[r.shape];
        if (k >= mesh.instanceMatrix.count) continue;
        q.setFromAxisAngle(up, r.yaw);
        m.compose(p.set(r.x, r.y0, r.z), q, sc.set(r.r, r.k, r.r));
        mesh.setMatrixAt(k, m);
        // Each rock a slightly different stone: greyer, warmer or greener.
        const s = r.seed;
        mesh.setColorAt(
          k,
          col.setRGB(0.92 + s * 0.12, 0.93 + (1 - s) * 0.08, 0.9 + ((s * 7) % 1) * 0.1),
        );
        counter[r.shape]++;
      }
      const B = it.bungalows;
      for (let i = 0; i < B.length && bc < this.bungalows.instanceMatrix.count; i += 3) {
        q.setFromAxisAngle(up, B[i + 2]);
        m.compose(p.set(B[i], 0, B[i + 1]), q, sc.set(1, 1, 1));
        this.bungalows.setMatrixAt(bc, m);
        this.panes.setMatrixAt(bc++, m);
      }
      const D = it.decks;
      for (let i = 0; i < D.length && dc < this.decks.instanceMatrix.count; i += 4) {
        q.setFromAxisAngle(up, D[i + 2]);
        m.compose(p.set(D[i], DECK_Y - 2.1, D[i + 1]), q, sc.set(1, 1, D[i + 3]));
        this.decks.setMatrixAt(dc++, m);
      }
      const V = it.boats;
      for (let i = 0; i < V.length; i += 4) {
        const t = V[i];
        const mesh = this.boats[t];
        if (boatC[t] >= mesh.instanceMatrix.count) continue;
        q.setFromAxisAngle(up, V[i + 3]);
        m.compose(p.set(V[i + 1], 0, V[i + 2]), q, sc.set(1, 1, 1));
        mesh.setMatrixAt(boatC[t]++, m);
      }
      const N = it.lanterns;
      for (let i = 0; i < N.length && lc < this.lanterns.instanceMatrix.count; i += 4) {
        const s = N[i + 3];
        m.makeScale(s, s, s).setPosition(N[i], N[i + 1], N[i + 2]);
        this.lanterns.setMatrixAt(lc++, m);
      }
    }
    const counts: [THREE.InstancedMesh, number][] = [
      ...this.rocks.map((mesh, i): [THREE.InstancedMesh, number] => [mesh, rc[i]]),
      ...this.farRocks.map((mesh, i): [THREE.InstancedMesh, number] => [mesh, fc[i]]),
      [this.bungalows, bc],
      [this.panes, bc],
      [this.decks, dc],
      [this.boats[0], boatC[0]],
      [this.boats[1], boatC[1]],
      [this.lanterns, lc],
    ];
    for (const [mesh, n] of counts) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.trees.rebuild(this.treeLists, px, pz, Config.render.treeDistance);
  }

  /** Windows and lanterns: dark timber and brass by day, glowing warm as the light goes. */
  frame(day: DayCycle): void {
    const night = smoothstep(0.08, 0.6, day.palette.stars) * Config.atoll.windows;
    this.paneMaterial.color.copy(DAY_PANE).lerp(NIGHT_PANE, night);
    this.lanternMaterial.color.copy(DAY_LANTERN).lerp(NIGHT_LANTERN, night);
  }

  dispose(): void {
    for (const mesh of [
      ...this.rocks,
      ...this.farRocks,
      this.bungalows,
      this.panes,
      this.decks,
      ...this.boats,
      this.lanterns,
    ]) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.material.dispose();
    this.rockMaterial.dispose();
    this.paneMaterial.dispose();
    this.lanternMaterial.dispose();
    this.trees.dispose();
  }
}
