import * as THREE from 'three';
import { Config } from '../../core/Config';
import { smoothstep } from '../../core/math';
import type { World } from '../../levels/World';
import type { FlightInput, FlightState } from '../../player/FlightModel';
import { avoidSolids, glanceOffWall } from '../city/collide';
import { ChunkManager } from '../ChunkManager';
import { withGroundDetail } from '../GroundDetail';
import type { DayCycle } from '../DayCycle';
import { mistUniforms, withMist } from '../Mist';
import { createNoise2D } from '../noise';
import { createChunkGeometry, getToonGradient, type HeightField } from '../Terrain';
import { FjordDecor, type FjordChunk } from './FjordDecor';
import { FjordLayout } from './FjordLayout';
import { FjordPlanner } from './FjordWisps';
import { beamGeometry, lampGeometry, lighthouseGeometry } from './geometry';
import type { DiscoveryDef } from '../Discoveries';
import { fjordFinds } from './finds';
import { withFjordRock } from './rock';

const C = {
  bed: new THREE.Color('#1d3442'),
  shallows: new THREE.Color('#4f7480'),
  pebble: new THREE.Color('#8d8f94'),
  grass: new THREE.Color('#6d8a4e'),
  meadow: new THREE.Color('#8a9150'),
  heath: new THREE.Color('#7d6448'),
  fell: new THREE.Color('#8a8a64'),
  spruce: new THREE.Color('#3f5e44'),
  rock: new THREE.Color('#646a74'),
  rockDark: new THREE.Color('#474c56'),
  snow: new THREE.Color('#eef3fa'),
};
const WHITE = new THREE.Color('#fff');
const DAY_LAMP = new THREE.Color('#d8dde2');
const NIGHT_LAMP = new THREE.Color(5, 4.2, 2.6);
const BEAM = new THREE.Color('#ffe6b0');

/**
 * Aurora Fjords as a World: the layout's fjords streamed as terrain chunks, spruce, hamlets
 * and ice as instanced decor, a lighthouse sweeping its beam over the water, and a low sea
 * smoke (the shared valley-mist shader) that thickens at night. The walls are terrain, flown
 * with the city's look-ahead (it veers along the fjord) and a glance off anything steep.
 */
export class FjordWorld implements World {
  readonly group = new THREE.Group();
  readonly field: HeightField;
  readonly layout: FjordLayout;
  readonly planner: FjordPlanner;
  readonly discoveries: readonly DiscoveryDef[];
  private readonly chunks: ChunkManager<FjordChunk>;
  private readonly decor: FjordDecor;
  private readonly tower: THREE.Mesh;
  private readonly lamp: THREE.Mesh;
  private readonly beam: THREE.Mesh;
  private readonly n = { x: 0, y: 0, z: 0 };

  constructor(seed: number) {
    const L = (this.layout = new FjordLayout(seed));
    this.discoveries = fjordFinds(L);
    const tint = createNoise2D(seed + 420);
    this.field = {
      height: (x, z) => L.height(x, z),
      forest: (x, z) => L.forest(x, z),
      tint: (x, z) => tint(x * 0.004, z * 0.004),
    };
    this.decor = new FjordDecor(L);
    this.chunks = new ChunkManager(this.field, {
      decor: this.decor,
      material: withFjordRock(
        withGroundDetail(
          withMist(
            new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() }),
          ),
        ),
      ),
      color: (f, x, z, y, slope, out) => this.groundColor(f, x, z, y, slope, out),
      createGeometry: (res) => {
        const g = createChunkGeometry(res);
        const n = res + 1;
        g.setAttribute('aLand', new THREE.BufferAttribute(new Float32Array(n * n * 4), 4));
        // Its own index (the shared one alternates diagonals): see fillExtra.
        g.setIndex(new THREE.BufferAttribute(new Uint32Array(res * res * 6), 1));
        return g;
      },
      fillExtra: (g, ox, oz, size, res) => this.fillExtra(g, ox, oz, size, res),
    });
    this.planner = new FjordPlanner(L);

    const H = L.lighthouse;
    this.tower = new THREE.Mesh(
      lighthouseGeometry(H.h, H.r),
      withMist(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() })),
    );
    this.lamp = new THREE.Mesh(
      lampGeometry(H.h, H.r),
      new THREE.MeshBasicMaterial({ color: DAY_LAMP.clone() }),
    );
    this.beam = new THREE.Mesh(
      beamGeometry(170, 9),
      new THREE.MeshBasicMaterial({
        color: BEAM.clone(),
        vertexColors: true,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.tower.name = 'lighthouse';
    this.beam.name = 'lighthouse-beam';
    for (const m of [this.tower, this.lamp]) m.position.set(H.x, H.y0, H.z);
    this.beam.position.set(H.x, H.y0 + H.h - 2.85, H.z);
    this.group.add(this.chunks.group, this.tower, this.lamp, this.beam);
  }

  private groundColor(
    f: HeightField,
    x: number,
    z: number,
    y: number,
    slope: number,
    out: THREE.Color,
  ): THREE.Color {
    if (y < -0.3) return out.copy(C.shallows).lerp(C.bed, smoothstep(-0.3, -8, y));
    const t = f.tint(x, z);
    // Pebbles at the water, turf on the strand (greener low, the heath's russet and olive
    // higher up and out on the fell), darker under the forest.
    out.copy(C.grass).lerp(C.meadow, 0.5 + 0.5 * t);
    out.lerp(C.heath, smoothstep(6, 40, y) * (0.55 + 0.45 * t));
    out.lerp(C.fell, smoothstep(90, 150, y) * (0.5 - 0.4 * t));
    out.lerp(C.spruce, f.forest(x, z) * 0.6);
    out.lerp(C.pebble, 1 - smoothstep(0.9, 1.6, y));
    // Cliffs: bare rock (the shader paints the relief and the snow's ledges over it).
    out.lerp(C.rock, smoothstep(0.3, 0.55, slope));
    out.lerp(C.rockDark, smoothstep(0.5, 0.8, slope) * (0.5 + 0.5 * t));
    // Snow, as the shader lays it on the flat (the cover leaves it bare, and samples this).
    const s = y > 20 ? this.layout.snow(x, z, y) : 0;
    out.lerp(C.snow, smoothstep(0.4, 0.55, s * 1.15) * (1 - smoothstep(0.3, 0.5, slope)));
    return out.multiplyScalar(0.96 + 0.05 * t);
  }

  /**
   * After a chunk's heights: its `aLand` (rock.ts) and its triangles. Each quad is split along
   * the diagonal whose ends are nearer in height, so the split runs along a wall's foot or lip
   * instead of across it: no sawtooth where the strand meets the wall (as in Red Canyons).
   */
  private fillExtra(g: THREE.BufferGeometry, ox: number, oz: number, size: number, res: number) {
    const L = this.layout;
    const n = res + 1;
    const step = size / res;
    const P = g.getAttribute('position').array as Float32Array;
    const landAttr = g.getAttribute('aLand') as THREE.BufferAttribute;
    const land = landAttr.array as Float32Array;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        L.landAt(ox + i * step, oz + j * step, P[k * 3 + 1], land, k * 4);
      }
    landAttr.needsUpdate = true;
    const index = g.getIndex()!;
    const idx = index.array as Uint32Array;
    let w = 0;
    for (let j = 0; j < res; j++)
      for (let i = 0; i < res; i++) {
        const a = j * n + i;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        const ad = Math.abs(P[a * 3 + 1] - P[d * 3 + 1]);
        const bc = Math.abs(P[b * 3 + 1] - P[c * 3 + 1]);
        if (bc < ad) {
          idx[w++] = a;
          idx[w++] = c;
          idx[w++] = b;
          idx[w++] = b;
          idx[w++] = c;
          idx[w++] = d;
        } else {
          idx[w++] = a;
          idx[w++] = c;
          idx[w++] = d;
          idx[w++] = a;
          idx[w++] = d;
          idx[w++] = b;
        }
      }
    index.needsUpdate = true;
  }

  flightGround(x: number, z: number): number {
    return this.layout.ground(x, z);
  }

  surfaceBelow(x: number, y: number, z: number): number {
    const H = this.layout.lighthouse;
    if (y >= H.y0 + H.h && Math.hypot(x - H.x, z - H.z) < H.r) return H.y0 + H.h;
    return this.flightGround(x, z);
  }

  /** Generic wisp paths ride over the walls near their line rather than into them. */
  wispFloor(x: number, z: number): number {
    const L = this.layout;
    let g = L.ground(x, z);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      g = Math.max(g, L.height(x + Math.sin(a) * 22, z + Math.cos(a) * 22) + 4);
    }
    return g;
  }

  prime(px: number, pz: number): void {
    this.chunks.prime(px, pz);
  }

  update(px: number, pz: number): void {
    this.chunks.update(px, pz);
  }

  frame(_dt: number, time: number, day: DayCycle): void {
    const K = Config.fjord;
    const p = day.palette;
    const night = smoothstep(0.08, 0.6, p.stars);
    // Sea smoke: frost mist on the water, thickest in the cold of the night.
    const u = mistUniforms;
    // By day the air clears (dayHaze): the walls keep their layers but read as rock, not ghosts.
    const clear = K.dayHaze + (1 - K.dayHaze) * night;
    u.uMist.value = K.seaSmoke * (0.35 + 0.65 * night) * clear;
    u.uMistTop.value = K.mistTop;
    u.uMistFar.value = K.mistFar * clear;
    u.uMistColor.value.copy(p.fog).lerp(p.skyHorizon, 0.3);
    u.uMistTime.value = time;
    this.decor.frame(day);
    (this.lamp.material as THREE.MeshBasicMaterial).color
      .copy(DAY_LAMP)
      .lerp(NIGHT_LAMP, night * K.windows);
    const beam = this.beam.material as THREE.MeshBasicMaterial;
    beam.opacity = 0.3 * night * K.windows;
    this.beam.visible = beam.opacity > 0.005;
    this.beam.rotation.y = time * K.beamSpeed;
  }

  assist(s: FlightState, input: FlightInput): void {
    avoidSolids(s, input, this.layout);
  }

  collide(s: FlightState): number {
    const n = this.n;
    const d = this.layout.pushPoint(s, Config.flight.clearance, n);
    if (d > 0) {
      if (n.y > 0.5) s.liftVy = Math.max(s.liftVy, 2);
      else glanceOffWall(s, n.x, n.z);
      return 1 + d * 10;
    }
    if (s.contact !== 'ground') return 0;
    // Touched a steep wall (the flight model lifted the bird onto it): glance off downhill.
    const L = this.layout;
    const e = 2;
    const gx = (L.height(s.x + e, s.z) - L.height(s.x - e, s.z)) / (2 * e);
    const gz = (L.height(s.x, s.z + e) - L.height(s.x, s.z - e)) / (2 * e);
    const g = Math.hypot(gx, gz);
    if (g < 0.9) return 0;
    glanceOffWall(s, -gx / g, -gz / g);
    return g;
  }

  pushPoint(p: { x: number; y: number; z: number }, margin: number): void {
    this.layout.pushPoint(p, margin, this.n);
  }

  /** Thermals rise over open water or flat snow, clear of the walls. */
  thermalOk(x: number, z: number, r: number): boolean {
    const L = this.layout;
    const h = L.height(x, z);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const d = r + 20;
      if (Math.abs(L.height(x + Math.sin(a) * d, z + Math.cos(a) * d) - h) > 15) return false;
    }
    return true;
  }

  get chunkCount(): number {
    return this.chunks.count;
  }

  get pending(): number {
    return this.chunks.pending;
  }

  dispose(): void {
    this.chunks.dispose();
    for (const m of [this.tower, this.lamp, this.beam]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    mistUniforms.uMist.value = 0;
    mistUniforms.uMistFar.value = 0;
    mistUniforms.uMistColor.value.copy(WHITE);
  }
}
