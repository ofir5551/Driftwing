import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Config } from '../core/Config';
import type { DayCycle } from '../world/DayCycle';
import { createPaperTexture, PainterlyShader } from './shaders/painterly';
import { ShaftsShader, sunOnScreen } from './shaders/shafts';

const sunNdc = new THREE.Vector3();

/** render -> light shafts (optional) -> bloom (optional) -> painterly grade/grain/vignette -> output (sRGB). */
export class Composer {
  readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly paint: ShaderPass;
  private readonly renderPass: RenderPass;
  private readonly shafts: ShaderPass;
  /** Light-shaft brightness for this level and preset (Game sets it; 0 skips the pass). */
  shaftStrength = 0;
  /** 0..1 screen flash for celebrations, decays automatically. */
  flash = 0;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.shafts = new ShaderPass(ShaftsShader);
    this.shafts.enabled = false;
    this.composer.addPass(this.shafts);
    // Bloom at half resolution: it is soft by nature, so the saving is free.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.6, 0.75);
    this.composer.addPass(this.bloom);
    this.paint = new ShaderPass(PainterlyShader);
    this.paint.uniforms.tPaper.value = createPaperTexture();
    this.composer.addPass(this.paint);
    this.composer.addPass(new OutputPass());
  }

  setCamera(camera: THREE.Camera): void {
    this.renderPass.camera = camera;
  }

  setBloomEnabled(on: boolean): void {
    this.bloom.enabled = on;
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    this.bloom.resolution.set((w * pixelRatio) / 2, (h * pixelRatio) / 2);
    this.paint.uniforms.uResolution.value.set(w * pixelRatio, h * pixelRatio);
  }

  /**
   * Aim the shafts at the sun on screen. The pass is skipped (no cost) when the level or preset
   * has none, the sun is down, or it is off screen.
   */
  private updateShafts(day: DayCycle): void {
    let k = 0;
    if (this.shaftStrength > 0 && day.sunDir.y > -0.02) {
      const cam = this.renderPass.camera;
      sunNdc.copy(day.sunDir).multiplyScalar(1000).add(cam.position).project(cam);
      k = this.shaftStrength * sunOnScreen(sunNdc.x, sunNdc.y, sunNdc.z);
      const u = this.shafts.uniforms;
      const L = Config.light;
      u.uSun.value.set(sunNdc.x * 0.5 + 0.5, sunNdc.y * 0.5 + 0.5);
      u.uColor.value.copy(day.palette.sun);
      u.uStrength.value = k;
      u.uThreshold.value = L.shaftThreshold;
      u.uReach.value = L.shaftReach;
      u.uDecay.value = L.shaftDecay;
    }
    this.shafts.enabled = k > 0.001;
  }

  render(day: DayCycle, time: number, dt: number, saturation = 1): void {
    const r = Config.render;
    this.bloom.strength = r.bloomStrength;
    this.bloom.radius = r.bloomRadius;
    this.bloom.threshold = r.bloomThreshold;
    const u = this.paint.uniforms;
    u.uTime.value = time;
    u.uGrade.value.copy(day.palette.grade);
    u.uShadowTint.value.copy(day.palette.hemiGround).lerp(day.palette.skyTop, 0.4);
    u.uSaturation.value = r.saturation * saturation;
    u.uGrain.value = r.grain;
    u.uVignette.value = r.vignette;
    this.flash = Math.max(0, this.flash - dt * 1.5);
    u.uFlash.value = this.flash;
    this.updateShafts(day);
    this.composer.render(dt);
  }
}
