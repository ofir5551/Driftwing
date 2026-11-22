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
import { createChunkGeometry, getToonGradient, type HeightField } from '../Terrain';
import { CanyonDecor, type CanyonChunk } from './CanyonDecor';
import { CanyonLayout } from './CanyonLayout';
import { CanyonPlanner } from './CanyonWisps';
import type { DiscoveryDef } from '../Discoveries';
import { canyonDestinations } from './destinations';
import type { DestinationSource } from '../Destinations';
import { canyonFinds } from './finds';
import { canyonCover } from './cover';
import { canyonTime, dustUniforms } from './materials';
import { bounceUniforms, withRockStrata } from './rock';

const C = {
  bed: new THREE.Color('#2c4a44'),
  shallows: new THREE.Color('#5f8a70'),
  wetSand: new THREE.Color('#a8865c'),
  bank: new THREE.Color('#7f9548'),
  sand: new THREE.Color('#d9b583'),
  scrub: new THREE.Color('#a39d72'),
  desert: new THREE.Color('#cfa575'),
  scree: new THREE.Color('#b9805a'),
  cap: new THREE.Color('#ead0a2'),
  dust: new THREE.Color('#d8b48a'),
};
const WHITE = new THREE.Color('#fff');
const tmp = new THREE.Color();

/**
 * Red Canyons as a World: the layout's canyons streamed as terrain chunks, painted per pixel
 * (rock.ts: the rock strata and desert varnish, the road, the wash beds, slickrock, the shade
 * under a dwelling's brow) over vertex colours (the river's green banks, sand, scree, desert,
 * caprock), with grass, desert shrubs, cacti and wildflowers round the bird; trees, rock,
 * ranches, cliff dwellings and the small things of the desert as instanced decor. A warm
 * light bounces off the red walls into the canyon's shade, a dust haze lies in the canyons
 * by day and over the far mesas always, and a little mist fills them at first light. The walls
 * are terrain, flown with the city's look-ahead (it veers along the canyon, or eases under an
 * arch) and a glance off anything steep; arches, hoodoos and dwellings' brows are solid.
 */
export class CanyonWorld implements World {
  readonly group = new THREE.Group();
  readonly field: HeightField;
  readonly layout: CanyonLayout;
  readonly planner: CanyonPlanner;
  readonly discoveries: readonly DiscoveryDef[];
  readonly destinations: DestinationSource;
  private readonly chunks: ChunkManager<CanyonChunk>;
  private readonly decor: CanyonDecor;
  private readonly n = { x: 0, y: 0, z: 0 };

  constructor(seed: number) {
    const L = (this.layout = new CanyonLayout(seed));
    this.discoveries = canyonFinds(L);
    this.destinations = canyonDestinations(L);
    const tint = createNoise2D(seed + 620);
    this.field = {
      height: (x, z) => L.height(x, z),
      forest: (x, z) => L.scrub(x, z),
      tint: (x, z) => tint(x * 0.004, z * 0.004),
    };
    this.decor = new CanyonDecor(L);
    this.chunks = new ChunkManager(this.field, {
      decor: this.decor,
      material: withRockStrata(
        withGroundDetail(
          withMist(
            new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() }),
          ),
        ),
        'terrain',
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
      cover: canyonCover(),
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
    const L = this.layout;
    const t = f.tint(x, z);
    L.canyon(x, z);
    const s = L.cd - L.river(x, z);
    // The floor: wet sand at the water, the river's green corridor (where the cottonwoods
    // stand), then pale sand and silver scrub; the plateau a warmer, redder desert.
    const green = smoothstep(0.45, 1.2, y) * (1 - smoothstep(14, 26, s + 6 * t));
    out.copy(C.wetSand).lerp(C.bank, green * (0.8 + 0.2 * t));
    out.lerp(C.sand, smoothstep(0.6, 1.6, y) * (1 - green));
    out.lerp(C.desert, smoothstep(20, 60, y));
    out.lerp(C.scrub, f.forest(x, z) * 0.35 * smoothstep(1.8, 3, y) * (1 - green));
    // Scree: rubble of the redder layers above, on the talus at each cliff's foot. (The rock
    // strata themselves, and the varnish, are painted per pixel: rock.ts.)
    const scree = smoothstep(0.08, 0.2, slope) * (1 - smoothstep(0.35, 0.5, slope));
    out.lerp(C.scree, scree * 0.55);
    // Cream caprock on level ground high up (mesa tops and the highest rims).
    const steep = smoothstep(0.28, 0.55, slope);
    const capLine = Config.canyon.plateau + 30 + t * 10;
    out.lerp(C.cap, smoothstep(capLine, capLine + 25, y) * (1 - steep) * 0.6);
    return out.multiplyScalar(0.95 + 0.06 * t + 0.03 * (hash2(x | 0, z | 0, 3) - 0.5));
  }

  /**
   * After a chunk's heights: its `aLand` (rock.ts: road, wash, slickrock, a brow's shade) and
   * its triangles. Each quad is split along the diagonal whose ends are nearer in height, so
   * the split runs along a cliff's foot or lip instead of across it: no sawtooth where each
   * cliff meets its bench (the shared index alternates the diagonal, which zigzags there).
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
    const LL = Config.levelLight.canyon;
    const p = day.palette;
    canyonTime.value = time;
    const sun = smoothstep(0.02, 0.35, day.sunDir.y);
    // Mist lies in the canyons at first light and burns off by mid-morning; by day a thinner
    // warm dust haze fills them instead (up to hazeTop); the haze over the far mesas stays.
    const morning = Math.pow(0.5 + 0.5 * Math.cos(day.phase * Math.PI * 2), 4);
    const mist = K.mist * morning;
    const haze = LL.haze * sun;
    const sum = Math.max(mist + haze, 1e-6);
    const u = mistUniforms;
    u.uMist.value = mist + haze;
    u.uMistTop.value = (mist * K.mistTop + haze * K.hazeTop) / sum;
    u.uMistFar.value = K.mistFar;
    u.uMistColor.value.copy(p.fog).lerp(p.skyHorizon, 0.35);
    tmp.copy(p.fog).lerp(p.hemiGround, 0.3);
    u.uMistColor.value.lerp(tmp, haze / sum);
    u.uMistTime.value = time;
    // Warm light off the sunlit red walls into the shade (the palette's ground light).
    bounceUniforms.uBounceColor.value
      .copy(p.hemiGround)
      .lerp(p.sun, 0.25)
      .multiplyScalar(LL.bounce * sun * p.sunIntensity);
    bounceUniforms.uBounceTop.value = K.plateau;
    // Dust devils catch the light of the hour and fade into the fog like the land.
    dustUniforms.uColor.value
      .copy(C.dust)
      .multiply(p.sun)
      .multiplyScalar(0.55 + 0.45 * sun)
      .lerp(p.fog, 0.25);
    dustUniforms.uFogColor.value.copy(p.fog);
    dustUniforms.uFogFar.value = Config.render.drawDistance * 0.95;
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
    bounceUniforms.uBounceColor.value.setScalar(0);
  }
}
