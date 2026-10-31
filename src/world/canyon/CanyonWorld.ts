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
import { createNoise2D, hash2 } from '../noise';
import { getToonGradient, type HeightField } from '../Terrain';
import { CanyonDecor, type CanyonChunk } from './CanyonDecor';
import { CanyonLayout } from './CanyonLayout';
import { CanyonPlanner } from './CanyonWisps';

const C = {
  bed: new THREE.Color('#2c4a44'),
  shallows: new THREE.Color('#5f8a70'),
  wetSand: new THREE.Color('#a8865c'),
  bank: new THREE.Color('#7f9548'),
  sand: new THREE.Color('#d9b583'),
  scrub: new THREE.Color('#a39d72'),
  desert: new THREE.Color('#cfa575'),
  varnish: new THREE.Color('#5e3324'),
  cap: new THREE.Color('#ead0a2'),
};
/**
 * The walls' rock layers from the floor up, repeated: deep red, rust, a pale band, orange,
 * a darker red, and the cream sandstone that caps the rims and mesas.
 */
const STRATA = ['#9a4429', '#b85a33', '#dba574', '#c8703e', '#a94d2e', '#d08a55', '#e6c597'].map(
  (h) => new THREE.Color(h),
);
const WHITE = new THREE.Color('#fff');
const band = new THREE.Color();

/**
 * Red Canyons as a World: the layout's canyons streamed as terrain chunks painted in level rock
 * strata, scrub, cottonwoods, hoodoos and arches as instanced decor, a dust haze over the far
 * mesas and a little mist in the canyons at first light. The walls are terrain, flown with the
 * city's look-ahead (it veers along the canyon, or eases under an arch) and a glance off
 * anything steep; arches and hoodoos are solid.
 */
export class CanyonWorld implements World {
  readonly group = new THREE.Group();
  readonly field: HeightField;
  readonly layout: CanyonLayout;
  readonly planner: CanyonPlanner;
  private readonly chunks: ChunkManager<CanyonChunk>;
  private readonly decor: CanyonDecor;
  private readonly n = { x: 0, y: 0, z: 0 };

  constructor(seed: number) {
    const L = (this.layout = new CanyonLayout(seed));
    const tint = createNoise2D(seed + 620);
    this.field = {
      height: (x, z) => L.height(x, z),
      forest: (x, z) => L.scrub(x, z),
      tint: (x, z) => tint(x * 0.004, z * 0.004),
    };
    this.decor = new CanyonDecor(L);
    this.chunks = new ChunkManager(this.field, {
      decor: this.decor,
      material: withGroundDetail(
        withMist(
          new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() }),
        ),
      ),
      color: (f, x, z, y, slope, out) => this.groundColor(f, x, z, y, slope, out),
    });
    this.planner = new CanyonPlanner(L);
    this.group.add(this.chunks.group);
  }

  private groundColor(
    f: HeightField,
    x: number,
    z: number,
    y: number,
    slope: number,
    out: THREE.Color,
  ): THREE.Color {
    if (y < -0.3) return out.copy(C.shallows).lerp(C.bed, smoothstep(-0.3, -4, y));
    const t = f.tint(x, z);
    // The floor: wet sand at the water, a green bank, then pale sand and silver scrub; the
    // plateau a warmer, redder desert.
    out.copy(C.wetSand).lerp(C.bank, smoothstep(0.5, 1.4, y) * (0.6 + 0.3 * t));
    out.lerp(C.sand, smoothstep(1.6, 3, y));
    out.lerp(C.desert, smoothstep(20, 60, y));
    out.lerp(C.scrub, f.forest(x, z) * 0.35 * smoothstep(1.8, 3, y));
    // Rock strata: level bands, wobbling a little so they read as painted layers, not rulings.
    const k = Math.floor((y + 2.4 * t + 1.2 * Math.sin(x * 0.013 + z * 0.009)) / 7.5);
    band.copy(STRATA[((k % STRATA.length) + STRATA.length) % STRATA.length]);
    const steep = smoothstep(0.28, 0.55, slope);
    // Cliffs show the bare band; benches and the plateau carry its colour faintly in the scree.
    out.lerp(band, Math.max(steep * 0.95, smoothstep(6, 16, y) * 0.3));
    // Desert varnish: dark streaks down the steepest faces.
    const streak = 0.5 + 0.5 * Math.sin(x * 0.31 + z * 0.27 + t * 4);
    out.lerp(C.varnish, smoothstep(0.6, 0.85, slope) * streak * 0.35);
    // Cream caprock on level ground high up (mesa tops and the highest rims).
    const capLine = Config.canyon.plateau + 30 + t * 10;
    out.lerp(C.cap, smoothstep(capLine, capLine + 25, y) * (1 - steep) * 0.6);
    return out.multiplyScalar(0.95 + 0.06 * t + 0.03 * (hash2(x | 0, z | 0, 3) - 0.5));
  }

  flightGround(x: number, z: number): number {
    return this.layout.ground(x, z);
  }

  surfaceBelow(x: number, y: number, z: number): number {
    const L = this.layout;
    let top = L.ground(x, z);
    for (const a of L.nearArches(x, z)) {
      const t = L.archTop(a, x, z);
      if (t <= y && t > top) top = t;
    }
    const h = L.hoodooTop(x, z);
    if (h <= y && h > top) top = h;
    return top;
  }

  /** Generic wisp paths ride over the walls, arches and hoodoos near their line. */
  wispFloor(x: number, z: number): number {
    const L = this.layout;
    let g = L.ground(x, z);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const sx = x + Math.sin(a) * 22;
      const sz = z + Math.cos(a) * 22;
      g = Math.max(g, L.height(sx, sz) + 4);
    }
    for (const a of L.nearArches(x, z)) {
      const ox = a.r * 1.3 + 22;
      if (Math.abs(x - a.x) < ox && Math.abs(z - a.z) < ox) g = Math.max(g, a.y0 + a.h * 1.24 + 6);
    }
    return Math.max(g, L.hoodooTopNear(x, z, 22) + 6);
  }

  prime(px: number, pz: number): void {
    this.chunks.prime(px, pz);
  }

  update(px: number, pz: number): void {
    this.chunks.update(px, pz);
  }

  frame(_dt: number, time: number, day: DayCycle): void {
    const K = Config.canyon;
    const p = day.palette;
    // Mist lies in the canyons at first light and burns off by mid-morning; the dust haze
    // over the far mesas stays all day.
    const morning = Math.pow(0.5 + 0.5 * Math.cos(day.phase * Math.PI * 2), 4);
    const u = mistUniforms;
    u.uMist.value = K.mist * morning;
    u.uMistTop.value = K.mistTop;
    u.uMistFar.value = K.mistFar;
    u.uMistColor.value.copy(p.fog).lerp(p.skyHorizon, 0.35);
    u.uMistTime.value = time;
  }

  assist(s: FlightState, input: FlightInput): void {
    avoidSolids(s, input, this.layout);
  }

  collide(s: FlightState): number {
    const n = this.n;
    const d = this.layout.pushPoint(s, Config.flight.clearance, n);
    if (d > 0) {
      if (n.y > 0.5) s.liftVy = Math.max(s.liftVy, 2);
      else if (n.y > -0.5) glanceOffWall(s, n.x, n.z);
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

  /** Warm air rises off the open floors and the plateau, clear of the walls. */
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
    mistUniforms.uMist.value = 0;
    mistUniforms.uMistFar.value = 0;
    mistUniforms.uMistColor.value.copy(WHITE);
  }
}
