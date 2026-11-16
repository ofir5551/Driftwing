import * as THREE from 'three';
import { Config } from '../core/Config';
import { smoothstep } from '../core/math';
import { SHADOW_LAYER } from '../world/ShadowCasters';

const UP = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const right = new THREE.Vector3();
const lup = new THREE.Vector3();

/**
 * Moves `target` (the shadow box's centre) by less than a texel so it sits on the shadow map's
 * texel grid in light space. The box follows the bird every frame; without this its edges
 * resample a different texel grid each frame and crawl. The light camera looks along -sunDir
 * with world up, so its right and up axes are cross(up, sunDir) and cross(sunDir, right).
 * Pure (Three math only): unit-tested in Node.
 */
export function snapToTexel(
  target: THREE.Vector3,
  sunDir: THREE.Vector3,
  texel: number,
): THREE.Vector3 {
  right.crossVectors(UP, sunDir);
  // A sun straight overhead has no "right": any horizontal axis is as good as another.
  if (right.lengthSq() < 1e-8) right.copy(X);
  right.normalize();
  lup.crossVectors(sunDir, right).normalize();
  const a = target.dot(right);
  const b = target.dot(lup);
  target.addScaledVector(right, Math.round(a / texel) * texel - a);
  target.addScaledVector(lup, Math.round(b / texel) * texel - b);
  return target;
}

/** Shadow darkness for the sun's height: 0 below shadowSunMin (low sun, night), full above shadowSunFull. */
export function shadowFade(sunY: number): number {
  return smoothstep(Config.light.shadowSunMin, Config.light.shadowSunFull, sunY);
}

/** Where the shadow map's shadows fade out, shared by every lit material (see fadeSunShadow). */
export const sunShadowUniforms = {
  uSunShadowFocus: { value: new THREE.Vector3() },
  /** x: distance from the focus where shadows start to fade, y: where they are gone. */
  uSunShadowFade: { value: new THREE.Vector2(1e6, 2e6) },
};

/** Declarations for `fadeSunShadow` (after <common>). */
export const SUN_SHADOW_PARS = /* glsl */ `
uniform vec3 uSunShadowFocus;
uniform vec2 uSunShadowFade;`;

const DIRECTIONAL_LOOKUP =
  /getShadow\( directionalShadowMap\[ i \][^;]*vDirectionalShadowCoord\[ i \] \)/;

/**
 * The lights chunk with the sun's shadow fading out with distance from the bird, for a fragment
 * shader that has a world position in `worldPos`. The map covers a box round the bird; without
 * the fade, shadows ended at its edge and so appeared out of nowhere as the bird flew up to
 * them. Faded, they thin out into the distance (where contact shadows take over).
 */
export function fadeSunShadow(worldPos: string): string {
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  const out = chunk.replace(
    DIRECTIONAL_LOOKUP,
    (lookup) =>
      `mix( ${lookup}, 1.0, smoothstep( uSunShadowFade.x, uSunShadowFade.y, distance( ${worldPos}.xz, uSunShadowFocus.xz ) ) )`,
  );
  if (out === chunk) throw new Error('fadeSunShadow: three changed its directional shadow lookup');
  return out;
}

/**
 * The sun's shadow map: a box round the bird (Config.light.shadowRange), soft PCF and partial
 * (a painted shade, not a black cut-out). On only on presets with `render.shadows` and levels
 * with a shadow strength. Toggling `castShadow` recompiles every lit material, so it changes
 * only with the preset or the level; at night and in a low sun the shadows fade out through
 * `shadow.intensity` and the map stops updating (no recompile, no shadow pass).
 */
export class SunShadows {
  private readonly target = new THREE.Vector3();
  /** Whether the map has been drawn since shadows were last switched on. */
  private drawn = false;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly sun: THREE.DirectionalLight,
  ) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    const L = Config.light;
    const sh = sun.shadow;
    // A phone gets a smaller map: the same reach, softer shadows, a quarter of the memory.
    const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const size = Math.min(
      touch ? L.shadowMapSizeTouch : L.shadowMapSize,
      renderer.capabilities.maxTextureSize,
    );
    sh.mapSize.set(size, size);
    sh.camera.near = 1;
    sh.camera.far = 1000;
    sh.camera.layers.enable(SHADOW_LAYER);
    sun.castShadow = false;
  }

  /** Whether this preset and level draw shadows (changes recompile lit materials once). */
  setEnabled(on: boolean): void {
    if (this.sun.castShadow === on) return;
    this.sun.castShadow = on;
    this.drawn = false;
    if (!on) this.renderer.shadowMap.needsUpdate = false;
  }

  get enabled(): boolean {
    return this.sun.castShadow;
  }

  /** Per frame: aim the box at the bird, snapped to texels; fade with the sun's height. */
  update(focus: THREE.Vector3, sunDir: THREE.Vector3, strength: number): void {
    if (!this.sun.castShadow) return;
    const L = Config.light;
    const sh = this.sun.shadow;
    const r = L.shadowRange;
    const cam = sh.camera;
    if (cam.right !== r) {
      cam.left = cam.bottom = -r;
      cam.right = cam.top = r;
      cam.updateProjectionMatrix();
    }
    sh.bias = L.shadowBias;
    sh.normalBias = L.shadowNormalBias;
    // The blur is set in metres, so the look doesn't change with the map's size or reach.
    const texel = (2 * r) / sh.mapSize.x;
    sh.radius = Math.max(1, L.shadowSoftness / texel);
    sunShadowUniforms.uSunShadowFocus.value.copy(focus);
    sunShadowUniforms.uSunShadowFade.value.set(r * L.shadowFadeStart, r * L.shadowFadeEnd);
    const k = strength * shadowFade(sunDir.y);
    sh.intensity = k;
    // A faded-out map is never sampled to any effect, so skip the shadow pass, but draw it once
    // after shadows switch on: until a map exists, every shadow-receiving draw binds a depth
    // sampler to no depth texture and fails, and the scene vanishes (a level opening at night
    // or in a low sun would stay blank until the sun climbed).
    const draw = k > 0.001 || !this.drawn;
    this.renderer.shadowMap.needsUpdate = draw;
    if (!draw) return;
    this.drawn = true;
    snapToTexel(this.target.copy(focus), sunDir, texel);
    this.sun.target.position.copy(this.target);
    this.sun.position.copy(sunDir).multiplyScalar(500).add(this.target);
  }
}
