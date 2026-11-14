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
export function snapToTexel(target: THREE.Vector3, sunDir: THREE.Vector3, texel: number): THREE.Vector3 {
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

/**
 * The sun's shadow map: a box round the bird (Config.light.shadowRange), soft PCF and partial
 * (a painted shade, not a black cut-out). On only on presets with `render.shadows` and levels
 * with a shadow strength. Toggling `castShadow` recompiles every lit material, so it changes
 * only with the preset or the level; at night and in a low sun the shadows fade out through
 * `shadow.intensity` and the map stops updating (no recompile, no shadow pass).
 */
export class SunShadows {
  private readonly target = new THREE.Vector3();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly sun: THREE.DirectionalLight,
  ) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    const L = Config.light;
    const sh = sun.shadow;
    sh.mapSize.set(L.shadowMapSize, L.shadowMapSize);
    sh.camera.near = 1;
    sh.camera.far = 1000;
    sh.camera.layers.enable(SHADOW_LAYER);
    sun.castShadow = false;
  }

  /** Whether this preset and level draw shadows (changes recompile lit materials once). */
  setEnabled(on: boolean): void {
    if (this.sun.castShadow === on) return;
    this.sun.castShadow = on;
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
    sh.radius = L.shadowSoftness;
    const k = strength * shadowFade(sunDir.y);
    sh.intensity = k;
    // A faded-out map is never sampled to any effect, so skip the shadow pass.
    this.renderer.shadowMap.needsUpdate = k > 0.001;
    if (k <= 0.001) return;
    snapToTexel(this.target.copy(focus), sunDir, (2 * r) / sh.mapSize.x);
    this.sun.target.position.copy(this.target);
    this.sun.position.copy(sunDir).multiplyScalar(500).add(this.target);
  }
}
