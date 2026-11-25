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
import { hash2 } from '../noise';
import { getToonGradient, type HeightField } from '../Terrain';
import { propTime } from '../highlands/materials';
import { jerusalemCover } from './cover';
import { JerusalemDecor, type JerusalemChunk } from './JerusalemDecor';
import { FIELD, JerusalemLayout } from './JerusalemLayout';
import { JerusalemPlanner } from './JerusalemWisps';
import { createLandGeometry, fillLand, withLand } from './land';
import { createStoneUniforms, foliageUniforms, type StoneUniforms } from './materials';
import type { DiscoveryDef } from '../Discoveries';
import { jerusalemFinds } from './finds';
import { jerusalemDestinations } from './destinations';
import type { DestinationSource } from '../Destinations';

const C = {
  dry: new THREE.Color('#cdb27c'),
  straw: new THREE.Color('#dcc48e'),
  scrub: new THREE.Color('#9c9864'),
  soil: new THREE.Color('#ad8a68'),
  orchard: new THREE.Color('#a99d6c'),
  needles: new THREE.Color('#7f8858'),
  valley: new THREE.Color('#9ea566'),
  rock: new THREE.Color('#ddd0b2'),
  riser: new THREE.Color('#d4c7a6'),
  pave: new THREE.Color('#dccdab'),
  platform: new THREE.Color('#e2d6ba'),
  lawn: new THREE.Color('#a9ad72'),
  yard: new THREE.Color('#cdbd9c'),
  cemetery: new THREE.Color('#e3ddcf'),
  garrigue: new THREE.Color('#a2a074'),
  stubble: new THREE.Color('#dcc07c'),
  plough: new THREE.Color('#b0714f'),
  crop: new THREE.Color('#a3b064'),
  fallow: new THREE.Color('#c6b67e'),
};
const FIELD_COLOR = [C.stubble, C.plough, C.crop, C.fallow];
const SHADE = new THREE.Color();
const WHITE = new THREE.Color('#fff');

/**
 * City of Gold as a World: the layout's hills streamed as terrain chunks, its stone as one
 * instanced material, a morning mist pooled in the valleys and a haze layering the far hills.
 * Walls, towers and domes are solid but soft, flown with the city's look-ahead and wall
 * glance; low roofs and treetops are soft ground the bird skims.
 */
export class JerusalemWorld implements World {
  readonly group = new THREE.Group();
  readonly field: HeightField;
  readonly layout: JerusalemLayout;
  readonly planner: JerusalemPlanner;
  readonly discoveries: readonly DiscoveryDef[];
  readonly destinations: DestinationSource;
  private readonly uniforms: StoneUniforms;
  private readonly chunks: ChunkManager<JerusalemChunk>;
  private readonly decor: JerusalemDecor;
  private readonly n = { x: 0, y: 0, z: 0 };

  constructor(seed: number) {
    const L = (this.layout = new JerusalemLayout(seed));
    this.discoveries = jerusalemFinds(L);
    this.destinations = jerusalemDestinations(L);
    this.uniforms = createStoneUniforms();
    this.field = {
      height: (x, z) => L.height(x, z),
      forest: (x, z) => {
        L.at(x, z);
        return Math.max(L.pine, L.olive * 0.6);
      },
      tint: (x, z) => {
        L.at(x, z);
        return L.tint;
      },
    };
    this.decor = new JerusalemDecor(L, this.uniforms);
    this.chunks = new ChunkManager(this.field, {
      decor: this.decor,
      material: withLand(
        withGroundDetail(
          withMist(
            new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() }),
          ),
        ),
      ),
      color: (_f, x, z, _y, slope, out) => this.groundColor(x, z, slope, out),
      createGeometry: createLandGeometry,
      fillExtra: (g, ox, oz, size, res) => fillLand(L, g, ox, oz, size, res),
      cover: jerusalemCover(L),
    });
    this.planner = new JerusalemPlanner(L);
    this.group.add(this.chunks.group);
  }

  private groundColor(x: number, z: number, slope: number, out: THREE.Color): THREE.Color {
    const L = this.layout;
    // Walled fields first (deciding one moves the layout's scratch point).
    const field = L.fieldAt(x, z);
    L.at(x, z);
    const t = L.tint;
    // Dry summer hills: golden grass and grey-green garrigue, red terra rossa where it's worked.
    out
      .copy(C.dry)
      .lerp(C.straw, 0.5 + 0.5 * t)
      .lerp(C.scrub, 0.35 + 0.3 * t);
    out.lerp(C.valley, L.valley * 0.55);
    out.lerp(C.orchard, L.olive * 0.6);
    out.lerp(C.soil, L.terrace * (0.35 + 0.15 * t));
    out.lerp(C.needles, L.pine * 0.75);
    // Grey-green garrigue in drifts on the open hills, so they aren't one gold.
    const open = (1 - L.olive) * (1 - L.pine) * (1 - L.town) * smoothstep(40, 80, L.sd);
    out.lerp(C.garrigue, open * smoothstep(-0.1, 0.5, L.tint) * 0.5);
    if (field >= 0) out.lerp(FIELD_COLOR[field], field === FIELD.FALLOW ? 0.5 : 0.8);
    // Pale limestone breaking through on the steep ground, dry-stone terrace walls.
    out.lerp(C.rock, smoothstep(0.3, 0.55, slope + t * 0.08) * 0.85);
    out.lerp(C.riser, L.riser * 0.6);
    out.lerp(C.yard, L.town * 0.75);
    if (L.sd < 20) {
      // Inside the walls: stone paving; the platform's paving with lawns under its trees.
      const inside = 1 - smoothstep(-6, 20, L.sd);
      out.lerp(C.pave, inside);
      if (L.inPlatform(x, z)) {
        const lawn = smoothstep(0.2, 0.5, t) * (1 - L.onDais(x, z));
        out.copy(C.platform).lerp(C.lawn, lawn * 0.6);
      }
    }
    const cem = L.cemetery(x, z);
    if (cem > 0) out.lerp(C.cemetery, cem * (0.55 + 0.25 * hash2(x | 0, z | 0, 3)));
    return out.multiplyScalar(0.95 + 0.06 * t);
  }

  flightGround(x: number, z: number): number {
    return this.layout.ground(x, z);
  }

  surfaceBelow(x: number, y: number, z: number): number {
    return Math.max(this.flightGround(x, z), this.layout.roofBelow(x, y, z));
  }

  /** Generic wisp paths ride over any tower near their line rather than into it. */
  wispFloor(x: number, z: number): number {
    return Math.max(this.flightGround(x, z), this.layout.skyline(x, z, 18) + 6);
  }

  prime(px: number, pz: number): void {
    this.decor.eager = true;
    this.chunks.prime(px, pz);
    this.decor.eager = false;
  }

  update(px: number, pz: number): void {
    this.chunks.update(px, pz);
    this.decor.tick();
  }

  frame(_dt: number, time: number, day: DayCycle): void {
    const K = Config.jerusalem;
    const p = day.palette;
    const u = this.uniforms;
    propTime.value = time;
    u.uJBevel.value = K.bevel;
    u.uJBevelPx.value = K.bevelPx;
    u.uJWeather.value = K.weathering;
    foliageUniforms.uFDetail.value = K.foliageDetail;
    // Shade takes the sky's hue (normalised to its brightest channel: a tint, not a light).
    SHADE.copy(p.skyTop);
    SHADE.multiplyScalar(1 / Math.max(SHADE.r, SHADE.g, SHADE.b, 1e-3));
    u.uJShade.value.setRGB(1, 1, 1).lerp(SHADE, K.coolShade * (1 - u.uJNight.value * 0.7));
    // Lights come on through dusk and stay on until dawn.
    u.uJNight.value = smoothstep(0.05, 0.55, p.stars);
    u.uJLights.value = K.lights;
    u.uJFlood.value = K.flood;
    u.uJSky.value.copy(p.skyHorizon);
    u.uJSun.value.copy(p.sun).multiplyScalar(p.sunIntensity);
    u.uJSunDir.value.copy(day.sunDir);
    // Mist pools in the valleys at first light and burns off by mid-morning; a little gathers
    // again at night.
    const morning = Math.pow(0.5 + 0.5 * Math.cos(day.phase * Math.PI * 2), 3);
    const m = mistUniforms;
    m.uMist.value = K.mist * (0.25 + 0.75 * morning);
    m.uMistTop.value = K.mistTop;
    m.uMistFar.value = K.mistFar;
    // The far haze leans toward the sky overhead: distance turns blue-violet, not more orange.
    m.uMistColor.value.copy(p.fog).lerp(p.skyHorizon, 0.25).lerp(p.skyTop, 0.2);
    m.uMistTime.value = time;
  }

  assist(s: FlightState, input: FlightInput): void {
    avoidSolids(s, input, this.layout);
  }

  collide(s: FlightState): number {
    const n = this.n;
    const d = this.layout.pushPoint(s, Config.flight.clearance, n);
    if (d <= 0) return 0;
    if (n.y > 0.5) {
      // Skimming a dome, a wall walk or a tower top: the same soft touch as the ground.
      s.liftVy = Math.max(s.liftVy, 2);
      if (s.pitchSpring.x < 0) {
        s.pitchSpring.x *= 0.5;
        s.pitchSpring.v = Math.max(s.pitchSpring.v, 0.8);
      }
      s.speed -= s.speed * Config.flight.skimSlowdown * (1 / 60);
    } else glanceOffWall(s, n.x, n.z);
    return 1 + d * 10;
  }

  pushPoint(p: { x: number; y: number; z: number }, margin: number): void {
    this.layout.pushPoint(p, margin, this.n);
  }

  /** Thermals rise over the open hills, clear of the towns and the stone. */
  thermalOk(x: number, z: number, r: number): boolean {
    const L = this.layout;
    L.at(x, z);
    return L.sd > 120 && L.town < 0.2 && L.skyline(x, z, r + 20) === -Infinity;
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
