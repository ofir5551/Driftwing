import * as THREE from 'three';
import { Config } from '../../core/Config';
import { smoothstep } from '../../core/math';
import type { ChunkDecor } from '../ChunkManager';
import { ContactShadows } from '../ContactShadows';
import type { DayCycle } from '../DayCycle';
import { withMist } from '../Mist';
import { ShadowCasters } from '../ShadowCasters';
import { getToonGradient } from '../Terrain';
import { Trees } from '../Trees';
import { commitInstances } from '../instances';
import {
  cloudPineDetailGeometry,
  cloudPineGeometry,
  hermitageGeometry,
  monasteryGeometry,
  SPIRE_FAR,
  SPIRE_HERO,
  SPIRE_NEAR,
  spireGeometry,
} from './geometry';
import { withGranite } from './granite';
import { craneMaterial, propMaterial } from './materials';
import { Temple, type PeaksLayout, type Spire } from './PeaksLayout';
import {
  K,
  PeaksScatter,
  placeLocal,
  PROP_KINDS,
  PROP_STRIDE,
  type Dressing,
} from './PeaksScatter';
import { ropeAt, type Flock, type Rope } from './PeaksSites';
import {
  boulderGeometry,
  bridgeSegmentGeometry,
  craneGeometry,
  dwarfPineGeometry,
  FLAG_COLORS,
  flagSegmentGeometry,
  grassGeometry,
  hutGeometry,
  mossGeometry,
  pavilionGeometry,
  pineDistantGeometry,
  postGeometry,
  shrineGeometry,
  snowGeometry,
  stepGeometry,
  windowGeometry,
} from './shapes';
import { SKINS } from './skin';

export interface PeaksChunk extends Dressing {
  ox: number;
  oz: number;
  spires: Spire[];
  /** Rope bridges and flag lines owned by spires in the chunk. */
  ropes: Rope[];
  /** Crane flocks whose circle is centred in the chunk. */
  flocks: Flock[];
}

// Per prop kind (K: moss, grass, snow, boulder, hut, pavilion, shrine, step, post, dwarf pine):
/** 1 drawn within propDistance, 2 within smallPropDistance. */
const RANGE = [2, 2, 2, 2, 1, 1, 2, 1, 1, 2];
/** Instance capacity. */
const CAP = [5000, 5000, 3000, 2000, 120, 120, 300, 400, 40, 2000];
/** Casts a sun shadow (through near-only proxies, on high). */
const CASTS = [0, 0, 0, 1, 1, 1, 1, 0, 0, 0];
/** Contact-shadow radius at scale 1 (0 = none); blobs lie flat at the foot. */
const BLOB = [0, 0, 0, 1.0, 2.6, 3.2, 0.8, 0, 0, 1.4];
/** Drawn with the granite material (the stair is cut from the rock). */
const ROCK = [0, 0, 0, 0, 0, 0, 0, 1, 0, 0];

const m = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler(0, 0, 0, 'YZX');
const p = new THREE.Vector3();
const sc = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const col = new THREE.Color();
const pa = { x: 0, y: 0, z: 0 };
const pb = { x: 0, y: 0, z: 0 };
const DAY_LANTERN = new THREE.Color('#b8463b');
// HDR (> 1) so bloom halos the lanterns after dark.
const NIGHT_LANTERN = new THREE.Color(4.4, 1.9, 0.7);
const DAY_WINDOW = new THREE.Color('#4a3c33');
const NIGHT_WINDOW = new THREE.Color(2.6, 1.55, 0.6);
const WHITE = new THREE.Color('#fff');
/** The monastery's flag lines: from the tower's eaves out to the terrace wall. */
const MAYPOLE = { x: 6, y: 14.6, z: -7 };
const MAYPOLE_LINES = 7;

/**
 * Sea of Clouds' scenery as global instanced meshes refilled from the live chunks: five spire
 * silhouettes in three meshes each (finest within heroDetail, near, far), granite pines (near,
 * far and distant shapes) and dwarf pines in the Trees, the ledge cover and small things, the
 * hermits' huts and pavilions, temples and the monastery's stair, rope bridges and prayer flags,
 * crane flocks, and the lanterns and lit windows. Big things cast sun shadows through near-only
 * proxies (high); huts, pavilions, shrines and boulders get contact shadows (medium and high).
 * Refilled when the chunk set changes, writing into preallocated buffers.
 */
export class PeaksDecor implements ChunkDecor<PeaksChunk> {
  readonly group = new THREE.Group();
  private readonly material: THREE.MeshToonMaterial;
  private readonly rockMaterial: THREE.MeshToonMaterial;
  private readonly prop = propMaterial(false);
  private readonly cloth = propMaterial(true);
  private readonly craneMat = craneMaterial();
  readonly lanternMaterial: THREE.MeshBasicMaterial;
  private readonly windowMaterial: THREE.MeshBasicMaterial;
  private readonly scatterer: PeaksScatter;
  /** Per shape: the finest mesh (flank within render.heroDetail), near, far (past spireLod). */
  private readonly heroSpires: THREE.InstancedMesh[];
  private readonly spires: THREE.InstancedMesh[];
  private readonly farSpires: THREE.InstancedMesh[];
  private readonly spireCasters: ShadowCasters[];
  private readonly hermitages: THREE.InstancedMesh;
  private readonly monastery: THREE.InstancedMesh;
  private readonly templeCasters: ShadowCasters[];
  private readonly lanterns: THREE.InstancedMesh;
  private readonly windows: THREE.InstancedMesh;
  /** Per prop kind: its mesh, the far mesh of the kinds that have one, its shadow proxies. */
  private readonly near: THREE.InstancedMesh[] = [];
  private readonly far: (THREE.InstancedMesh | null)[] = [];
  private readonly casters: (ShadowCasters | null)[] = [];
  private readonly bridge: THREE.InstancedMesh;
  private readonly flags: THREE.InstancedMesh;
  private readonly cranes: THREE.InstancedMesh;
  private readonly craneSlots: THREE.InstancedBufferAttribute;
  private readonly contact = new ContactShadows(1500);
  readonly trees = new Trees(
    9000,
    [cloudPineGeometry()],
    [cloudPineDetailGeometry()],
    [pineDistantGeometry()],
  );
  private readonly treeLists: number[][] = [];
  private readonly nearCount = new Array<number>(PROP_KINDS).fill(0);
  private readonly farCount = new Array<number>(PROP_KINDS).fill(0);
  /** Instances per spire mesh (tier * shapes + shape), then hermitages and the monastery. */
  private readonly sc = new Array<number>(SKINS.length * 3 + 2).fill(0);
  private bn = 0;
  private fc = 0;
  private cc = 0;
  private lc = 0;
  private wc = 0;
  // The refill round's centre and ranges (squared).
  private px = 0;
  private pz = 0;
  private big2 = 0;
  private small2 = 0;
  private detail2 = 0;

  constructor(private readonly layout: PeaksLayout) {
    this.scatterer = new PeaksScatter(layout);
    this.trees.ground = (x, z) => layout.height(x, z); // contact shadows lie on the slope
    this.material = withMist(
      new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() }),
    );
    withMist(this.trees.material);
    this.lanternMaterial = new THREE.MeshBasicMaterial({ color: DAY_LANTERN.clone() });
    this.windowMaterial = new THREE.MeshBasicMaterial({ color: DAY_WINDOW.clone() });
    // Smooth lathed rock; the joints, lichen, moss and snow are painted by withGranite.
    this.rockMaterial = withGranite(
      withMist(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() })),
    );
    const rock = this.rockMaterial;
    const nearSpire = SKINS.map((sk) => spireGeometry(sk, SPIRE_NEAR));
    this.heroSpires = SKINS.map((sk, i) =>
      this.make(spireGeometry(sk, SPIRE_HERO), 60, rock, `spire-hero-${i}`),
    );
    this.spires = nearSpire.map((g, i) => this.make(g, 600, rock, `spire-${i}`));
    this.farSpires = SKINS.map((sk, i) =>
      this.make(spireGeometry(sk, SPIRE_FAR), 1600, rock, `spire-far-${i}`),
    );
    // Spires cast onto the cloud tops and each other on high (near-only proxies).
    this.spireCasters = nearSpire.map((g) => new ShadowCasters(g, rock, 200));
    const herm = hermitageGeometry();
    const mon = monasteryGeometry();
    this.hermitages = this.make(herm, 200, this.material, 'hermitage');
    this.monastery = this.make(mon, 4, this.material, 'monastery');
    this.templeCasters = [
      new ShadowCasters(herm, this.material, 40),
      new ShadowCasters(mon, this.material, 4),
    ];
    this.lanterns = this.make(
      new THREE.SphereGeometry(0.5, 8, 6).scale(1, 1.25, 1),
      3000,
      this.lanternMaterial,
      'lantern',
    );
    this.windows = this.make(windowGeometry(), 1500, this.windowMaterial, 'window');
    const near: THREE.BufferGeometry[] = [
      mossGeometry(),
      grassGeometry(),
      snowGeometry(),
      boulderGeometry(1),
      hutGeometry(true),
      pavilionGeometry(true),
      shrineGeometry(),
      stepGeometry(),
      postGeometry(),
      dwarfPineGeometry(true),
    ];
    const far: (THREE.BufferGeometry | null)[] = near.map(() => null);
    far[K.Boulder] = boulderGeometry(0);
    far[K.Dwarf] = dwarfPineGeometry(false);
    // Huts and pavilions are few: one shape each (two meshes would cost a draw call apiece).
    for (let k = 0; k < PROP_KINDS; k++) {
      const mat = ROCK[k] ? rock : this.prop;
      this.near.push(this.make(near[k], CAP[k], mat, `peaks-${k}`));
      const fg = far[k];
      this.far.push(fg ? this.make(fg, CAP[k], mat, `peaks-${k}-far`) : null);
      this.casters.push(
        CASTS[k] ? new ShadowCasters(fg ?? near[k], mat, Math.min(CAP[k], 400)) : null,
      );
    }
    this.bridge = this.make(bridgeSegmentGeometry(), 4000, this.prop, 'rope-bridge');
    this.flags = this.make(flagSegmentGeometry(), 6000, this.cloth, 'prayer-flags');
    const crane = craneGeometry();
    this.craneSlots = new THREE.InstancedBufferAttribute(new Float32Array(400 * 4), 4);
    crane.setAttribute('aSlot', this.craneSlots);
    this.cranes = this.make(crane, 400, this.craneMat, 'cranes');
    this.group.add(
      ...this.spireCasters.map((c) => c.mesh),
      ...this.templeCasters.map((c) => c.mesh),
      ...this.casters.flatMap((c) => (c ? [c.mesh] : [])),
      this.trees.group,
      this.contact.mesh,
    );
  }

  private make(
    geo: THREE.BufferGeometry,
    cap: number,
    mat: THREE.Material,
    name: string,
  ): THREE.InstancedMesh {
    if ((mat === this.prop || mat === this.cloth) && !geo.getAttribute('aAnim'))
      geo.setAttribute(
        'aAnim',
        new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2),
      );
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    mesh.count = 0;
    mesh.frustumCulled = false; // instances span the whole view
    mesh.name = name; // shows up in scripts/level-shots.mjs's triangle report
    this.group.add(mesh);
    return mesh;
  }

  scatter(ox: number, oz: number, size: number): PeaksChunk {
    const L = this.layout;
    const out: PeaksChunk = {
      ox,
      oz,
      spires: [],
      trees: [],
      props: [],
      temples: [],
      lanterns: [],
      windows: [],
      ropes: [],
      flocks: [],
    };
    const inside = (x: number, z: number) => x >= ox && x < ox + size && z >= oz && z < oz + size;
    const C = Config.peaks.spireCell;
    for (let j = Math.floor(oz / C); j <= Math.floor((oz + size) / C); j++)
      for (let i = Math.floor(ox / C); i <= Math.floor((ox + size) / C); i++) {
        for (const sp of L.cell(i, j)) {
          if (!inside(sp.x, sp.z)) continue;
          out.spires.push(sp);
          this.scatterer.dress(sp, out);
        }
        // A rope belongs to the chunk its owner's anchor stands in.
        for (const r of L.sites.ropes(i, j)) if (inside(r.x0, r.z0)) out.ropes.push(r);
      }
    for (const r of L.sites.gateRopes) if (inside(r.x0, r.z0)) out.ropes.push(r);
    const F = Config.peaks.flockCell;
    for (let j = Math.floor(oz / F); j <= Math.floor((oz + size) / F); j++)
      for (let i = Math.floor(ox / F); i <= Math.floor((ox + size) / F); i++) {
        const f = L.sites.flock(i, j);
        if (f && inside(f.x, f.z)) out.flocks.push(f);
      }
    return out;
  }

  rebuild(items: PeaksChunk[], px: number, pz: number): void {
    const R = Config.render;
    const size = Config.world.chunkSize;
    this.px = px;
    this.pz = pz;
    this.big2 = R.propDistance ** 2;
    this.small2 = R.smallPropDistance ** 2;
    this.detail2 = R.propDetail ** 2;
    this.nearCount.fill(0);
    this.farCount.fill(0);
    this.sc.fill(0);
    this.bn = this.fc = this.cc = this.lc = this.wc = 0;
    for (const c of this.spireCasters) c.begin(px, pz, size);
    for (const c of this.templeCasters) c.begin(px, pz, size);
    for (const c of this.casters) c?.begin(px, pz, size);
    this.contact.begin(px, pz);
    this.treeLists.length = 0;
    // The near mesh out to spireLod at the high preset's draw distance, scaled with the preset.
    const near2 = ((Config.peaks.spireLod * R.drawDistance) / 1150) ** 2;
    const hero = R.heroDetail;
    const S = this.spires.length;
    for (const it of items) {
      this.treeLists.push(it.trees);
      for (const sp of it.spires) {
        const d2 = (sp.x - px) ** 2 + (sp.z - pz) ** 2;
        const tier = hero > 0 && Math.sqrt(d2) - sp.reach < hero ? 0 : d2 < near2 ? 1 : 2;
        const mesh = (tier === 0 ? this.heroSpires : tier === 1 ? this.spires : this.farSpires)[
          sp.shape
        ];
        const k = tier * S + sp.shape;
        if (this.sc[k] >= mesh.instanceMatrix.count) continue;
        q.setFromAxisAngle(up, sp.yaw);
        m.compose(p.set(sp.x, sp.y0, sp.z), q, sc.set(sp.r, sp.r * sp.k, sp.r));
        mesh.setMatrixAt(this.sc[k], m);
        // Each spire a slightly different granite: warmer, cooler or paler.
        const s = sp.seed;
        mesh.setColorAt(
          this.sc[k]++,
          col.setRGB(0.92 + s * 0.12, 0.92 + ((s * 5) % 1) * 0.08, 0.9 + (1 - s) * 0.12),
        );
        this.spireCasters[sp.shape].add(sp.x, sp.z, m);
      }
      this.placeTemples(it.temples);
      this.placeProps(it.props);
      this.placeGlows(it.lanterns, it.windows);
      for (const r of it.ropes) this.placeRope(r);
      for (const f of it.flocks) this.placeFlock(f);
    }
    for (let t = 0; t < 3; t++)
      for (let i = 0; i < S; i++)
        commitInstances(
          (t === 0 ? this.heroSpires : t === 1 ? this.spires : this.farSpires)[i],
          this.sc[t * S + i],
        );
    commitInstances(this.hermitages, this.sc[S * 3]);
    commitInstances(this.monastery, this.sc[S * 3 + 1]);
    for (let k = 0; k < PROP_KINDS; k++) {
      commitInstances(this.near[k], this.nearCount[k]);
      const f = this.far[k];
      if (f) commitInstances(f, this.farCount[k]);
      this.casters[k]?.end();
    }
    commitInstances(this.bridge, this.bn);
    commitInstances(this.flags, this.fc);
    commitInstances(this.cranes, this.cc);
    this.craneSlots.clearUpdateRanges();
    if (this.cc > 0) {
      this.craneSlots.addUpdateRange(0, this.cc * 4);
      this.craneSlots.needsUpdate = true;
    }
    commitInstances(this.lanterns, this.lc);
    commitInstances(this.windows, this.wc);
    for (const c of this.spireCasters) c.end();
    for (const c of this.templeCasters) c.end();
    this.contact.end();
    this.trees.rebuild(this.treeLists, px, pz, R.treeDistance);
  }

  private placeTemples(T: readonly number[]): void {
    const S = this.spires.length;
    for (let i = 0; i < T.length; i += 5) {
      const mon = T[i + 4] === Temple.Monastery;
      const mesh = mon ? this.monastery : this.hermitages;
      const k = S * 3 + (mon ? 1 : 0);
      if (this.sc[k] >= mesh.instanceMatrix.count) continue;
      q.setFromAxisAngle(up, T[i + 3]);
      m.compose(p.set(T[i], T[i + 1], T[i + 2]), q, sc.set(1, 1, 1));
      mesh.setMatrixAt(this.sc[k]++, m);
      this.templeCasters[mon ? 1 : 0].add(T[i], T[i + 2], m);
      if (mon) this.maypole(T[i], T[i + 1], T[i + 2], T[i + 3]);
    }
  }

  /** Lines of flags from the monastery tower's eaves down to its terrace wall. */
  private maypole(x: number, y: number, z: number, yaw: number): void {
    if ((x - this.px) ** 2 + (z - this.pz) ** 2 > this.big2) return;
    const [tx, ty, tz] = placeLocal(x, y, z, yaw, MAYPOLE);
    for (let k = 0; k < MAYPOLE_LINES; k++) {
      const a = (k / MAYPOLE_LINES) * Math.PI * 2 + 0.3;
      const ex = x + Math.cos(a) * 14.6;
      const ez = z + Math.sin(a) * 14.6;
      this.flagLine(tx, ty, tz, ex, y + 3.2, ez, 1.2, k);
    }
  }

  /** Instance every prop record of a chunk list that is in range. */
  private placeProps(list: readonly number[]): void {
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
      const s = list[k + 5];
      q.setFromAxisAngle(up, list[k + 4]);
      m.compose(p.set(x, y, z), q, sc.set(s, s, s));
      mesh.setMatrixAt(idx, m);
      const t = list[k + 6];
      mesh.setColorAt(idx, col.setRGB(0.9 + t * 0.16, 0.92 + t * 0.1, 0.9 + (1 - t) * 0.12));
      counts[kind] = idx + 1;
      this.casters[kind]?.add(x, z, m);
      if (BLOB[kind] > 0) this.contact.add(x, y + 0.15, z, BLOB[kind] * s, null);
    }
  }

  private placeGlows(L: readonly number[], W: readonly number[]): void {
    const lm = this.lanterns;
    for (let i = 0; i < L.length && this.lc < lm.instanceMatrix.count; i += 4) {
      if ((L[i] - this.px) ** 2 + (L[i + 2] - this.pz) ** 2 > this.big2) continue;
      const s = L[i + 3];
      m.makeScale(s, s, s).setPosition(L[i], L[i + 1], L[i + 2]);
      lm.setMatrixAt(this.lc++, m);
    }
    const wm = this.windows;
    for (let i = 0; i < W.length && this.wc < wm.instanceMatrix.count; i += 4) {
      if ((W[i] - this.px) ** 2 + (W[i + 2] - this.pz) ** 2 > this.big2) continue;
      q.setFromAxisAngle(up, W[i + 3]);
      m.compose(p.set(W[i], W[i + 1], W[i + 2]), q, sc.set(1, 1, 1));
      wm.setMatrixAt(this.wc++, m);
    }
  }

  /** A rope bridge (plank segments, flags along one rail, lamps at its ends) or a flag line. */
  private placeRope(r: Rope): void {
    const mx = (r.x0 + r.x1) / 2;
    const mz = (r.z0 + r.z1) / 2;
    if ((mx - this.px) ** 2 + (mz - this.pz) ** 2 > this.big2) return;
    if (r.kind === 1) {
      this.flagLine(r.x0, r.y0, r.z0, r.x1, r.y1, r.z1, r.sag, Math.floor(r.seed * 5));
      return;
    }
    const len = Math.hypot(r.x1 - r.x0, r.y1 - r.y0, r.z1 - r.z0);
    const n = Math.max(3, Math.ceil(len / 2));
    const hx = (r.z1 - r.z0) / Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
    const hz = -(r.x1 - r.x0) / Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
    for (let k = 0; k < n; k++) {
      ropeAt(r, k / n, pa);
      ropeAt(r, (k + 1) / n, pb);
      if (this.bn >= this.bridge.instanceMatrix.count) return;
      this.segment(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z);
      this.bridge.setMatrixAt(this.bn++, m);
      // Flags along the rail on one side, every other plank.
      if (k % 2 === 0 && this.fc < this.flags.instanceMatrix.count) {
        const o = 0.72;
        this.segment(
          pa.x + hx * o,
          pa.y + 1.05,
          pa.z + hz * o,
          pb.x + hx * o,
          pb.y + 1.05,
          pb.z + hz * o,
        );
        this.flags.setMatrixAt(this.fc, m);
        this.flags.setColorAt(this.fc++, FLAG_COLORS[(k / 2 + Math.floor(r.seed * 5)) % 5]);
      }
    }
    // Lamps on the anchor posts at either end.
    for (const u of [0.02, 0.98]) {
      ropeAt(r, u, pa);
      if (this.lc < this.lanterns.instanceMatrix.count) {
        m.makeScale(0.75, 0.75, 0.75).setPosition(pa.x + hx * 0.9, pa.y + 1.5, pa.z + hz * 0.9);
        this.lanterns.setMatrixAt(this.lc++, m);
      }
    }
  }

  /** A sagging line of prayer flags, one flag per ~1.3 m, cycling the five colours. */
  private flagLine(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    sag: number,
    c0: number,
  ): void {
    const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    const n = Math.max(2, Math.ceil(len / 1.3));
    for (let k = 0; k < n && this.fc < this.flags.instanceMatrix.count; k++) {
      const u0 = k / n;
      const u1 = (k + 1) / n;
      this.segment(
        x0 + (x1 - x0) * u0,
        y0 + (y1 - y0) * u0 - sag * 4 * u0 * (1 - u0),
        z0 + (z1 - z0) * u0,
        x0 + (x1 - x0) * u1,
        y0 + (y1 - y0) * u1 - sag * 4 * u1 * (1 - u1),
        z0 + (z1 - z0) * u1,
      );
      this.flags.setMatrixAt(this.fc, m);
      this.flags.setColorAt(this.fc++, FLAG_COLORS[(k + c0) % 5]);
    }
  }

  /** `m` = a unit segment along +x stretched from a to b, level across (no roll). */
  private segment(ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const h = Math.hypot(dx, dz);
    e.set(0, Math.atan2(-dz, dx), Math.atan2(dy, h));
    q.setFromEuler(e);
    m.compose(p.set(ax, ay, az), q, sc.set(Math.hypot(h, dy), 1, 1));
  }

  /** A V of cranes on their circle: each bird's slot behind and outside the leader. */
  private placeFlock(f: Flock): void {
    const reach = Config.render.drawDistance * 0.8 + f.r;
    if ((f.x - this.px) ** 2 + (f.z - this.pz) ** 2 > reach * reach) return;
    const C = this.cranes;
    const a = this.craneSlots.array as Float32Array;
    for (let k = 0; k < f.n && this.cc < C.instanceMatrix.count; k++) {
      // Leader in front, then alternate arms of the V: 3.2 m back and 2.6 m out per place.
      const rank = Math.ceil(k / 2);
      const side = k === 0 ? 0 : (k % 2 ? 1 : -1) * rank * 2.6;
      m.makeTranslation(f.x, f.y + rank * 0.4, f.z);
      C.setMatrixAt(this.cc, m);
      C.setColorAt(this.cc, WHITE);
      a[this.cc * 4] = rank * 3.2;
      a[this.cc * 4 + 1] = side;
      a[this.cc * 4 + 2] = f.r * f.dir;
      a[this.cc * 4 + 3] = f.seed * Math.PI * 2;
      this.cc++;
    }
  }

  /** Lanterns and windows: dark by day, glowing warm as the light goes. */
  frame(day: DayCycle): void {
    const night = smoothstep(0.08, 0.6, day.palette.stars) * Config.peaks.lanterns;
    this.lanternMaterial.color.copy(DAY_LANTERN).lerp(NIGHT_LANTERN, night);
    this.windowMaterial.color.copy(DAY_WINDOW).lerp(NIGHT_WINDOW, night);
  }

  dispose(): void {
    for (const c of [...this.spireCasters, ...this.templeCasters]) c.dispose();
    for (const c of this.casters) c?.dispose();
    for (const mesh of [
      ...this.heroSpires,
      ...this.spires,
      ...this.farSpires,
      this.hermitages,
      this.monastery,
      this.lanterns,
      this.windows,
      ...this.near,
      this.bridge,
      this.flags,
      this.cranes,
    ]) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    for (const mesh of this.far) {
      mesh?.geometry.dispose();
      mesh?.dispose();
    }
    this.contact.dispose();
    this.material.dispose();
    this.rockMaterial.dispose();
    this.prop.dispose();
    this.cloth.dispose();
    this.craneMat.dispose();
    this.lanternMaterial.dispose();
    this.windowMaterial.dispose();
    this.trees.dispose();
  }
}
