import * as THREE from 'three';
import { Config } from '../../core/Config';
import { smoothstep } from '../../core/math';
import type { World } from '../../levels/World';
import type { FlightInput, FlightState } from '../../player/FlightModel';
import { avoidSolids, glanceOffWall } from '../city/collide';
import { ChunkManager } from '../ChunkManager';
import type { DayCycle } from '../DayCycle';
import { withGroundDetail } from '../GroundDetail';
import { mistUniforms, withMist } from '../Mist';
import { createNoise2D } from '../noise';
import { getToonGradient, type HeightField } from '../Terrain';
import { shipGeometry, shipGlowGeometry } from './geometry';
import { RingmoonDecor, type RingmoonChunk } from './RingmoonDecor';
import { RingmoonLayout } from './RingmoonLayout';
import { RingmoonPlanner } from './RingmoonWisps';

/**
 * Sea-floor and islet colours. The water over the shallows is fairly clear (the level's water
 * clarity), so the moss beds show through it: violet and amber patches on pale sand.
 */
const C = {
  sand: new THREE.Color('#d9d2b4'),
  mossViolet: new THREE.Color('#7a6aa8'),
  mossAmber: new THREE.Color('#c79a52'),
  mossTeal: new THREE.Color('#3f8f86'),
  deep: new THREE.Color('#2b6f78'),
  shore: new THREE.Color('#e3d6a8'),
  turf: new THREE.Color('#8a7cc0'),
  turfGold: new THREE.Color('#d1a95a'),
  ledge: new THREE.Color('#9a6a4a'),
  hill: new THREE.Color('#5f8e86'),
  hillTop: new THREE.Color('#c3b46e'),
};
const WHITE = new THREE.Color('#fff');
/** A skim over the shallows throws up a pale green spray. */
const SPRAY = new THREE.Color('#dcf5e6');
const GLOW_DAY = new THREE.Color('#e3b56a');
// HDR (> 1): the ship's seam and lamps bloom after dark.
const GLOW_NIGHT = new THREE.Color(4.2, 2.6, 1.1);

/**
 * Ringmoon Shallows as a World: the layout's sea floor and moss islets streamed as terrain
 * chunks under clear shallow water, instanced spires and flora, and the ship standing in the
 * shallows. Spires, hull and legs are solid but soft, flown with the city's look-ahead and
 * wall glance; under the belly the look-ahead eases the nose down rather than up.
 */
export class RingmoonWorld implements World {
  readonly group = new THREE.Group();
  readonly field: HeightField;
  readonly layout: RingmoonLayout;
  readonly planner: RingmoonPlanner;
  readonly skimColor = SPRAY;
  private readonly chunks: ChunkManager<RingmoonChunk>;
  private readonly decor: RingmoonDecor;
  private readonly shipMaterial: THREE.MeshToonMaterial;
  private readonly glowMaterial: THREE.MeshBasicMaterial;
  private readonly n = { x: 0, y: 0, z: 0 };

  constructor(seed: number) {
    const L = (this.layout = new RingmoonLayout(seed));
    const tint = createNoise2D(seed + 820);
    this.field = {
      height: (x, z) => L.height(x, z),
      forest: () => 0,
      tint: (x, z) => tint(x * 0.006, z * 0.006),
    };
    this.decor = new RingmoonDecor(L);
    this.chunks = new ChunkManager(this.field, {
      decor: this.decor,
      material: withGroundDetail(
        withMist(
          new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() }),
        ),
      ),
      color: (f, x, z, y, slope, out) => this.groundColor(f, x, z, y, slope, out),
    });
    this.planner = new RingmoonPlanner(L);
    // The ship: one mesh, and its glow.
    const S = L.ship;
    this.shipMaterial = withMist(
      new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() }),
    );
    this.glowMaterial = new THREE.MeshBasicMaterial({ color: GLOW_DAY.clone() });
    const ship = new THREE.Mesh(shipGeometry(S), this.shipMaterial);
    const glow = new THREE.Mesh(shipGlowGeometry(S), this.glowMaterial);
    for (const mesh of [ship, glow]) {
      mesh.position.set(S.x, S.y, S.z);
      mesh.rotation.y = S.yaw;
    }
    ship.name = 'ship';
    glow.name = 'ship-glow';
    this.group.add(this.chunks.group, ship, glow);
  }

  private groundColor(
    f: HeightField,
    x: number,
    z: number,
    y: number,
    slope: number,
    out: THREE.Color,
  ): THREE.Color {
    const t = f.tint(x, z);
    if (y < 0.4) {
      // The sea floor: pale sand with violet and amber moss beds in patches, teal deeper.
      out.copy(C.sand);
      out.lerp(C.mossViolet, smoothstep(-0.1, 0.35, t) * 0.75);
      out.lerp(C.mossAmber, smoothstep(-0.15, -0.45, t) * 0.7);
      out.lerp(C.mossTeal, smoothstep(-3.5, -6.5, y) * 0.6);
      out.lerp(C.deep, smoothstep(-6, -9, y));
      return out.multiplyScalar(0.95 + 0.06 * t);
    }
    // The islets: a pale shore, then violet turf patched with gold, rust ledges on the steps.
    out.copy(C.shore).lerp(C.turf, smoothstep(0.8, 2, y));
    out.lerp(C.turfGold, smoothstep(0.1, 0.45, t) * smoothstep(1.5, 3, y) * 0.8);
    // The mainland's hills: teal moss up their flanks, gold on the crowns.
    out.lerp(C.hill, smoothstep(9, 20, y) * (0.55 + 0.25 * t));
    out.lerp(C.hillTop, smoothstep(26, 44, y) * 0.7);
    out.lerp(C.ledge, smoothstep(0.35, 0.8, slope) * smoothstep(1, 2.5, y));
    return out.multiplyScalar(0.95 + 0.07 * t);
  }

  flightGround(x: number, z: number): number {
    const L = this.layout;
    const h = L.height(x, z);
    return h + L.canopy(h);
  }

  surfaceBelow(x: number, y: number, z: number): number {
    const s = this.layout.shipTop(x, z);
    const g = this.flightGround(x, z);
    return s <= y ? Math.max(g, s) : g;
  }

  /** Generic wisp paths ride over any stone near their line rather than into it. */
  wispFloor(x: number, z: number): number {
    return Math.max(this.flightGround(x, z), this.layout.skyline(x, z, 18) + 6);
  }

  prime(px: number, pz: number): void {
    this.chunks.prime(px, pz);
  }

  update(px: number, pz: number): void {
    this.chunks.update(px, pz);
  }

  frame(_dt: number, time: number, day: DayCycle): void {
    const R = Config.ringmoon;
    const p = day.palette;
    // No valley mist on the open shallows, only a haze that fades the far spires.
    const u = mistUniforms;
    u.uMist.value = 0;
    u.uMistFar.value = R.mistFar;
    u.uMistColor.value.copy(p.fog).lerp(p.skyHorizon, 0.4);
    u.uMistTime.value = time;
    const night = smoothstep(0.08, 0.6, p.stars) * R.glow;
    this.glowMaterial.color.copy(GLOW_DAY).lerp(GLOW_NIGHT, night);
    this.decor.frame(day);
  }

  assist(s: FlightState, input: FlightInput): void {
    avoidSolids(s, input, this.layout);
  }

  collide(s: FlightState): number {
    const n = this.n;
    const d = this.layout.pushPoint(s, Config.flight.clearance, n);
    if (d <= 0) return 0;
    if (n.y > 0.5) {
      // Over the hull's back or a spire's crown: the same soft touch as the ground.
      s.liftVy = Math.max(s.liftVy, 2);
      if (s.pitchSpring.x < 0) {
        s.pitchSpring.x *= 0.5;
        s.pitchSpring.v = Math.max(s.pitchSpring.v, 0.8);
      }
      s.speed -= s.speed * Config.flight.skimSlowdown * (1 / 60);
    } else if (n.y < -0.5) {
      // Brushing the belly: ease the nose down and out from under it.
      s.liftVy = Math.min(s.liftVy, 0);
      if (s.pitchSpring.x > 0) {
        s.pitchSpring.x *= 0.5;
        s.pitchSpring.v = Math.min(s.pitchSpring.v, -0.5);
      }
    } else glanceOffWall(s, n.x, n.z);
    return 1 + d * 10;
  }

  pushPoint(p: { x: number; y: number; z: number }, margin: number): void {
    this.layout.pushPoint(p, margin, this.n);
  }

  /** Thermals rise off the sun-warmed islets, clear of the stone and the ship. */
  thermalOk(x: number, z: number, r: number): boolean {
    const L = this.layout;
    return L.height(x, z) > 1.5 && L.skyline(x, z, r + 20) === -Infinity;
  }

  get chunkCount(): number {
    return this.chunks.count;
  }

  get pending(): number {
    return this.chunks.pending;
  }

  dispose(): void {
    this.chunks.dispose();
    for (const o of this.group.children)
      if (o instanceof THREE.Mesh && (o.name === 'ship' || o.name === 'ship-glow'))
        o.geometry.dispose();
    this.shipMaterial.dispose();
    this.glowMaterial.dispose();
    mistUniforms.uMist.value = 0;
    mistUniforms.uMistFar.value = 0;
    mistUniforms.uMistColor.value.copy(WHITE);
  }
}
