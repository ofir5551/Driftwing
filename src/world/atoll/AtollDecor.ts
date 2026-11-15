import * as THREE from 'three';
import { Config } from '../../core/Config';
import { smoothstep } from '../../core/math';
import type { ChunkDecor } from '../ChunkManager';
import { ContactShadows } from '../ContactShadows';
import type { DayCycle } from '../DayCycle';
import { withGroundDetail } from '../GroundDetail';
import { withMist } from '../Mist';
import { hash2 } from '../noise';
import { ShadowCasters } from '../ShadowCasters';
import { getToonGradient } from '../Terrain';
import { Trees } from '../Trees';
import { DECK_Y, ROCK_SHAPES, type AtollLayout, type Rock } from './AtollLayout';
import { AtollScatter, P, PROP_KINDS, PROP_STRIDE } from './AtollScatter';
import {
  bungalowGeometry,
  bungalowWindowsGeometry,
  canoeGeometry,
  DECK_LANTERN,
  deckGeometry,
  jungleDetailGeometry,
  jungleDistantGeometry,
  jungleGeometry,
  lanternGeometry,
  palmDetailGeometry,
  palmDistantGeometry,
  palmGeometry,
  rockGeometry,
  SAIL_LANTERN,
  sailboatGeometry,
  shrubGeometry,
} from './geometry';
import { withAtollLand } from './land';
import { atollTime, lifeMaterial, smokeMaterial, smokeUniforms } from './materials';
import {
  coralGeometry,
  FIRE_EMBERS,
  firePitGeometry,
  fishSchoolGeometry,
  HUT_LANTERN,
  netGeometry,
  paddleCanoeGeometry,
  rayGeometry,
  seabirdGeometry,
  stiltHutGeometry,
  turtleGeometry,
} from './shapes';

export interface AtollChunk {
  ox: number;
  oz: number;
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
  /** The villages' huts, walkways and fires (AtollScatter records), placed eagerly. */
  sites: number[];
  /** The lagoons' life, scattered the first time the chunk comes within prop distance. */
  props: number[] | null;
}

/** Per prop kind: 0 always drawn, 1 within propDistance, 2 within smallPropDistance. */
const RANGE = [0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 1];
/** Per prop kind: instance capacity (walkways and beached canoes share the pier and boat meshes). */
const CAP = [400, 0, 200, 0, 60, 300, 3000, 300, 120, 120, 300];
/** Per prop kind: contact-shadow radius at scale 1 (0 = none; huts only on land). */
const BLOB = [3.6, 0, 1.1, 1.6, 0, 0, 0, 0, 0, 0, 0];
/** Smoke puffs per fire (staggered up the column by phase). */
const PUFFS = 5;

/** Coral hues (multiplied over the heads' pale vertex colours). */
const CORALS = ['#f2a3b5', '#b9a0e0', '#ecd27a', '#8fd6c4', '#f5ae8a'].map((h) =>
  new THREE.Color(h).lerp(new THREE.Color('#fff'), 0.2),
);
const FRIGATE = new THREE.Color('#2b2a31');
const WHITE = new THREE.Color('#fff');

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
 * high islands, the bungalows and deck of every pier, boats moored on the lagoons, each
 * village's stilt huts, walkways and cooking fires (with their smoke), and the lagoons' life:
 * canoes pulled up on the beaches and out paddling, fishing nets, coral heads, schools of fish,
 * turtles, rays and seabirds (moving in the vertex shader). Windows, lanterns and embers glow
 * after dark. Huts and bungalows cast sun shadows through near-only proxies (high); huts on
 * land, canoes and fires get contact shadows. Refills write into preallocated buffers.
 */
export class AtollDecor implements ChunkDecor<AtollChunk> {
  readonly group = new THREE.Group();
  private readonly material: THREE.MeshToonMaterial;
  private readonly life = lifeMaterial();
  private readonly smokeMat = smokeMaterial();
  private readonly rockMaterial: THREE.MeshToonMaterial;
  private readonly paneMaterial: THREE.MeshBasicMaterial;
  private readonly lanternMaterial: THREE.MeshBasicMaterial;
  private readonly scatterer: AtollScatter;
  /** Rock meshes: per shape, a detailed one near the bird and a coarse one in the haze. */
  private readonly rocks: THREE.InstancedMesh[];
  private readonly farRocks: THREE.InstancedMesh[];
  private readonly bungalows: THREE.InstancedMesh;
  private readonly panes: THREE.InstancedMesh;
  private readonly decks: THREE.InstancedMesh;
  private readonly boats: THREE.InstancedMesh[];
  private readonly lanterns: THREE.InstancedMesh;
  /** Per prop kind its own mesh (null: walkways and canoes use the deck and boat meshes). */
  private readonly props: (THREE.InstancedMesh | null)[] = [];
  private readonly propCount = new Array<number>(PROP_KINDS).fill(0);
  private readonly smoke: THREE.InstancedMesh;
  private readonly smokePhase: THREE.InstancedBufferAttribute;
  private readonly hutCasters: ShadowCasters;
  private readonly bungalowCasters: ShadowCasters;
  private readonly contact = new ContactShadows(1200);
  readonly trees = new Trees(
    10000,
    [palmGeometry(), shrubGeometry(), jungleGeometry()],
    [palmDetailGeometry(), shrubGeometry(1), jungleDetailGeometry()],
    [palmDistantGeometry(), undefined, jungleDistantGeometry()],
  );
  private readonly treeLists: number[][] = [];
  // The refill round's counters, centre and ranges (squared).
  private dc = 0;
  private lc = 0;
  private sm = 0;
  private readonly boatC = [0, 0];
  private px = 0;
  private pz = 0;
  private big2 = 0;
  private small2 = 0;
  private smoke2 = 0;

  constructor(private readonly layout: AtollLayout) {
    this.scatterer = new AtollScatter(layout);
    this.trees.ground = (x, z) => layout.height(x, z); // contact shadows lie on the slope
    this.material = withMist(
      new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() }),
    );
    withMist(this.trees.material);
    // The caps' jungle wears the island's painted crowns.
    this.rockMaterial = withAtollLand(
      withGroundDetail(
        withMist(
          new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() }),
        ),
      ),
      false,
    );
    this.paneMaterial = new THREE.MeshBasicMaterial({ color: DAY_PANE.clone() });
    this.lanternMaterial = new THREE.MeshBasicMaterial({ color: DAY_LANTERN.clone() });
    const rock = this.rockMaterial;
    this.rocks = ROCK_SHAPES.map((sh, i) =>
      this.make(rockGeometry(sh, 90 + i, 18, 20), 500, rock, `rock-${i}`),
    );
    this.farRocks = ROCK_SHAPES.map((sh, i) =>
      this.make(rockGeometry(sh, 90 + i, 10, 10), 1400, rock, `rock-far-${i}`),
    );
    const bungalow = bungalowGeometry();
    this.bungalows = this.make(bungalow, 600, this.material, 'bungalow');
    this.panes = this.make(bungalowWindowsGeometry(), 600, this.paneMaterial, 'bungalow-pane');
    this.decks = this.make(deckGeometry(), 1200, this.material, 'deck');
    this.boats = [
      this.make(sailboatGeometry(), 400, this.material, 'sailboat'),
      this.make(canoeGeometry(), 900, this.material, 'canoe'),
    ];
    this.lanterns = this.make(lanternGeometry(), 2400, this.lanternMaterial, 'lantern');
    const shapes: (() => THREE.BufferGeometry)[] = [];
    shapes[P.Hut] = stiltHutGeometry;
    shapes[P.Fire] = firePitGeometry;
    shapes[P.Paddler] = paddleCanoeGeometry;
    shapes[P.Net] = netGeometry;
    shapes[P.Coral] = coralGeometry;
    shapes[P.Fish] = fishSchoolGeometry;
    shapes[P.Turtle] = turtleGeometry;
    shapes[P.Ray] = rayGeometry;
    shapes[P.Bird] = seabirdGeometry;
    const names = [
      'hut',
      '',
      'fire',
      '',
      'paddler',
      'net',
      'coral',
      'fish',
      'turtle',
      'ray',
      'seabird',
    ];
    let hutGeo: THREE.BufferGeometry | null = null;
    for (let k = 0; k < PROP_KINDS; k++) {
      const make = shapes[k];
      if (!make) {
        this.props.push(null);
        continue;
      }
      const g = make();
      if (k === P.Hut) hutGeo = g;
      const mat = g.getAttribute('aAnim') ? this.life : this.material;
      this.props.push(this.make(g, CAP[k], mat, `atoll-${names[k]}`));
    }
    this.hutCasters = new ShadowCasters(hutGeo!, this.material, 200);
    this.bungalowCasters = new ShadowCasters(bungalow, this.material, 120);
    const puff = new THREE.PlaneGeometry(1, 1);
    const cap = 200 * PUFFS;
    this.smokePhase = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    puff.setAttribute('aPhase', this.smokePhase);
    this.smoke = new THREE.InstancedMesh(puff, this.smokeMat, cap);
    this.smoke.count = 0;
    this.smoke.frustumCulled = false;
    this.smoke.renderOrder = 2; // transparent, after the ground and the water
    this.smoke.name = 'atoll-smoke';
    this.group.add(
      this.hutCasters.mesh,
      this.bungalowCasters.mesh,
      this.contact.mesh,
      this.smoke,
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

  scatter(ox: number, oz: number, size: number): AtollChunk {
    const L = this.layout;
    const seed = L.seed;
    const out: AtollChunk = {
      ox,
      oz,
      rocks: [],
      trees: [],
      bungalows: [],
      decks: [],
      boats: [],
      lanterns: [],
      sites: [],
      props: null,
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
    this.scatterer.trees(ox, oz, size, out.trees);
    this.scatterer.sites(ox, oz, size, out.sites);
    // A lantern over every other hut's porch, glowing after dark.
    const S = out.sites;
    for (let k = 0; k < S.length; k += PROP_STRIDE)
      if (S[k] === P.Hut && S[k + 6] < 0.5) {
        const s = S[k + 5];
        const l = HUT_LANTERN;
        place(
          out.lanterns,
          S[k + 1],
          S[k + 2],
          S[k + 3],
          S[k + 4],
          { x: l.x * s, y: l.y * s, z: l.z * s },
          0.8,
        );
      }
    // Boats moored on the lagoons, clear of the rocks, the villages and the opening run.
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
        if (L.nearVillage(x, z, 15)) continue;
        const type = hash2(i, j, seed + 34) < 0.6 ? 0 : 1;
        const yaw = hash2(i, j, seed + 35) * Math.PI * 2;
        out.boats.push(type, x, z, yaw);
        if (type === 0) place(out.lanterns, x, 0, z, yaw, SAIL_LANTERN, 0.9);
      }
    return out;
  }

  rebuild(items: AtollChunk[], px: number, pz: number): void {
    const R = Config.render;
    const size = Config.world.chunkSize;
    const reach = R.propDistance + size;
    this.treeLists.length = 0;
    for (const c of items) {
      this.treeLists.push(c.trees);
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
    this.trees.rebuild(this.treeLists, px, pz, R.treeDistance);

    this.px = px;
    this.pz = pz;
    this.big2 = R.propDistance ** 2;
    this.small2 = R.smallPropDistance ** 2;
    this.smoke2 = Math.min(R.propDistance, 450) ** 2;
    this.propCount.fill(0);
    this.hutCasters.begin(px, pz, size);
    this.bungalowCasters.begin(px, pz, size);
    this.contact.begin(px, pz);
    const rc = this.rocks.map(() => 0);
    const fc = this.rocks.map(() => 0);
    // Low (no prop detail) keeps the smooth rocks for the nearest only.
    const near2 = (Config.atoll.rockLod * (R.propDetail > 0 ? 1 : 0.35)) ** 2;
    let bc = 0;
    this.dc = 0;
    this.lc = 0;
    this.sm = 0;
    this.boatC[0] = this.boatC[1] = 0;
    for (const it of items) {
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
        this.bungalowCasters.add(B[i], B[i + 1], m);
      }
      const D = it.decks;
      for (let i = 0; i < D.length; i += 4) this.deck(D[i], D[i + 1], D[i + 2], 1, D[i + 3]);
      const V = it.boats;
      for (let i = 0; i < V.length; i += 4) {
        q.setFromAxisAngle(up, V[i + 3]);
        m.compose(p.set(V[i + 1], 0, V[i + 2]), q, sc.set(1, 1, 1));
        this.boat(V[i], m);
      }
      const N = it.lanterns;
      for (let i = 0; i < N.length; i += 4) this.lantern(N[i], N[i + 1], N[i + 2], N[i + 3]);
      this.place(it.sites);
      if (it.props) this.place(it.props);
    }
    const counts: [THREE.InstancedMesh, number][] = [
      ...this.rocks.map((mesh, i): [THREE.InstancedMesh, number] => [mesh, rc[i]]),
      ...this.farRocks.map((mesh, i): [THREE.InstancedMesh, number] => [mesh, fc[i]]),
      [this.bungalows, bc],
      [this.panes, bc],
      [this.decks, this.dc],
      [this.boats[0], this.boatC[0]],
      [this.boats[1], this.boatC[1]],
      [this.lanterns, this.lc],
      [this.smoke, this.sm],
    ];
    for (const [mesh, n] of counts) this.finish(mesh, n);
    for (let k = 0; k < PROP_KINDS; k++) {
      const mesh = this.props[k];
      if (mesh) this.finish(mesh, this.propCount[k]);
    }
    this.smokePhase.needsUpdate = true;
    this.hutCasters.end();
    this.bungalowCasters.end();
    this.contact.end();
  }

  private finish(mesh: THREE.InstancedMesh, n: number): void {
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  /** A run of plank deck (a pier's, or a village walkway's at `width` of it). */
  private deck(x: number, z: number, yaw: number, width: number, len: number): void {
    if (this.dc >= this.decks.instanceMatrix.count) return;
    q.setFromAxisAngle(up, yaw);
    m.compose(p.set(x, DECK_Y - 2.1, z), q, sc.set(width, 1, len));
    this.decks.setMatrixAt(this.dc++, m);
  }

  /** A boat of type t (0 sailboat, 1 canoe) at matrix m. */
  private boat(t: number, mat: THREE.Matrix4): void {
    const mesh = this.boats[t];
    if (this.boatC[t] >= mesh.instanceMatrix.count) return;
    mesh.setMatrixAt(this.boatC[t]++, mat);
  }

  private lantern(x: number, y: number, z: number, s: number): void {
    if (this.lc >= this.lanterns.instanceMatrix.count) return;
    m.makeScale(s, s, s).setPosition(x, y, z);
    this.lanterns.setMatrixAt(this.lc++, m);
  }

  /** Instance every record of a chunk list that is in range. */
  private place(list: readonly number[]): void {
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
      if (kind === P.Walk) {
        this.deck(x, z, yaw, 0.55, s);
        continue;
      }
      // Moving things carry no turn: the shader sets their heading round their circle.
      q.setFromAxisAngle(up, kind >= P.Paddler && kind !== P.Net && kind !== P.Coral ? 0 : yaw);
      m.compose(p.set(x, y, z), q, sc.set(s, s, s));
      if (kind === P.Canoe) this.boat(1, m);
      else {
        const mesh = this.props[kind]!;
        const idx = this.propCount[kind];
        if (idx >= mesh.instanceMatrix.count) continue;
        mesh.setMatrixAt(idx, m);
        if (kind === P.Coral) col.copy(CORALS[Math.floor(t * CORALS.length) % CORALS.length]);
        else if (kind === P.Bird) col.copy(t < 0.5 ? FRIGATE : WHITE);
        else col.setRGB(0.94 + t * 0.1, 0.94 + t * 0.08, 0.94 + (1 - t) * 0.08);
        mesh.setColorAt(idx, col);
        this.propCount[kind] = idx + 1;
      }
      if (kind === P.Hut) this.hutCasters.add(x, z, m);
      if (BLOB[kind] > 0 && (kind !== P.Hut || y > 0.3))
        this.contact.add(x, y + 0.1, z, BLOB[kind] * s, kind === P.Hut ? null : this.trees.ground);
      if (kind === P.Fire) {
        this.lantern(x + FIRE_EMBERS.x, y + FIRE_EMBERS.y, z + FIRE_EMBERS.z, 0.55);
        if (d2 < this.smoke2)
          for (let i = 0; i < PUFFS && this.sm < this.smoke.instanceMatrix.count; i++) {
            m.makeTranslation(x, y + 0.4, z);
            this.smoke.setMatrixAt(this.sm, m);
            this.smokePhase.setX(this.sm++, i / PUFFS + t * 0.13);
          }
      }
    }
  }

  /** Windows, lanterns and embers: dark timber and brass by day, glowing warm as the light goes. */
  frame(day: DayCycle, time: number): void {
    const p = day.palette;
    const night = smoothstep(0.08, 0.6, p.stars) * Config.atoll.windows;
    this.paneMaterial.color.copy(DAY_PANE).lerp(NIGHT_PANE, night);
    this.lanternMaterial.color.copy(DAY_LANTERN).lerp(NIGHT_LANTERN, night);
    atollTime.value = time;
    // Smoke takes the light of the hour and fades into the haze like the land.
    smokeUniforms.uColor.value.copy(p.hemiSky).lerp(p.sun, 0.3).lerp(p.fog, 0.25);
    smokeUniforms.uFogColor.value.copy(p.fog);
    smokeUniforms.uFogFar.value = Config.render.drawDistance * 0.95;
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
      this.smoke,
    ]) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    for (const mesh of this.props) {
      mesh?.geometry.dispose();
      mesh?.dispose();
    }
    this.hutCasters.dispose();
    this.bungalowCasters.dispose();
    this.contact.dispose();
    this.material.dispose();
    this.life.dispose();
    this.smokeMat.dispose();
    this.rockMaterial.dispose();
    this.paneMaterial.dispose();
    this.lanternMaterial.dispose();
    this.trees.dispose();
  }
}
