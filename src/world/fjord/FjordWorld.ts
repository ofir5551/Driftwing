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
import { getToonGradient, type HeightField } from '../Terrain';
import { FjordDecor, type FjordChunk } from './FjordDecor';
import { FjordLayout } from './FjordLayout';
import { FjordPlanner } from './FjordWisps';
import { beamGeometry, lampGeometry, lighthouseGeometry } from './geometry';

const C = {
  bed: new THREE.Color('#1d3442'),
  shallows: new THREE.Color('#4f7480'),
  pebble: new THREE.Color('#8d8f94'),
  moss: new THREE.Color('#5f7a62'),
  spruce: new THREE.Color('#3f5e52'),
  rock: new THREE.Color('#5d6470'),
  rockDark: new THREE.Color('#40454f'),
  snow: new THREE.Color('#eef3fa'),
  snowShade: new THREE.Color('#c9d6ea'),
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
  private readonly chunks: ChunkManager<FjordChunk>;
  private readonly decor: FjordDecor;
  private readonly tower: THREE.Mesh;
  private readonly lamp: THREE.Mesh;
  private readonly beam: THREE.Mesh;
  private readonly n = { x: 0, y: 0, z: 0 };

  constructor(seed: number) {
    const L = (this.layout = new FjordLayout(seed));
    const tint = createNoise2D(seed + 420);
    this.field = {
      height: (x, z) => L.height(x, z),
      forest: (x, z) => L.forest(x, z),
      tint: (x, z) => tint(x * 0.004, z * 0.004),
    };
    this.decor = new FjordDecor(L);
    this.chunks = new ChunkManager(this.field, {
      decor: this.decor,
      material: withGroundDetail(
        withMist(
          new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() }),
        ),
      ),
      color: (f, x, z, y, slope, out) => this.groundColor(f, x, z, y, slope, out),
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
    const K = Config.fjord;
    const t = f.tint(x, z);
    out.copy(C.pebble).lerp(C.moss, smoothstep(1.5, 3, y) * (0.6 + 0.3 * t));
    out.lerp(C.spruce, f.forest(x, z) * 0.8);
    // Cliffs: bare dark rock, streaked lighter and darker by the noise.
    out.lerp(C.rock, smoothstep(0.35, 0.6, slope));
    out.lerp(C.rockDark, smoothstep(0.55, 0.8, slope) * (0.5 + 0.5 * t));
    // Snow lies above the snowline on anything but sheer rock, and dusts the ledges lower down.
    const line = K.snowline + t * 18;
    const snow = smoothstep(line - 15, line + 10, y) * (1 - smoothstep(0.45, 0.7, slope));
    out.lerp(C.snow, Math.max(snow, smoothstep(0.62, 0.9, -slope + 1) * smoothstep(8, 30, y)));
    // Wind-shadowed snow in the hollows reads blue.
    out.lerp(C.snowShade, snow * smoothstep(0.1, 0.4, slope) * 0.7);
    return out.multiplyScalar(0.96 + 0.05 * t);
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
    u.uMist.value = K.seaSmoke * (0.35 + 0.65 * night);
    u.uMistTop.value = K.mistTop;
    u.uMistFar.value = K.mistFar;
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
