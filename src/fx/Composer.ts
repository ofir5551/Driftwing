import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Config } from '../core/Config';
import type { DayCycle } from '../world/DayCycle';
import { createPaperTexture, PainterlyShader } from './shaders/painterly';

/** render -> bloom (optional) -> painterly grade/grain/vignette -> output (sRGB). */
export class Composer {
  readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly paint: ShaderPass;
  private readonly renderPass: RenderPass;
  /** 0..1 screen flash for celebrations, decays automatically. */
  flash = 0;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
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
    this.composer.render(dt);
  }
}
