import * as THREE from 'three';
import { Config } from '../core/Config';
import type { DayCycle } from './DayCycle';
import { MIST_PARS, mistUniforms } from './Mist';

const vert = /* glsl */ `
#include <fog_pars_vertex>
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

// Painterly water: no reflections, just a palette tint, a fresnel blend toward the sky colour,
// slow interfering sine ripples for the normal and a soft sun glint that bloom picks up.
const frag = /* glsl */ `
#include <fog_pars_fragment>
${MIST_PARS}
uniform vec3 uColor;
uniform vec3 uSky;
uniform vec3 uSun;
uniform vec3 uSunDir;
uniform float uTime;
varying vec3 vWorld;

void main() {
  vec2 p = vWorld.xz;
  float t = uTime;
  vec2 g = vec2(0.0);
  g += vec2(cos(p.x * 0.11 + t * 0.9), cos(p.y * 0.13 + t * 0.7)) * 0.45;
  g += vec2(cos((p.x + p.y) * 0.21 - t * 1.3), cos((p.x - p.y) * 0.19 + t * 1.1)) * 0.25;
  g += vec2(cos(p.y * 0.53 + t * 2.1), cos(p.x * 0.47 - t * 1.7)) * 0.08;
  vec3 n = normalize(vec3(-g.x * 0.12, 1.0, -g.y * 0.12));
  vec3 v = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec3 col = mix(uColor, uSky * 0.9, 0.1 + fres * 0.55);
  vec3 h = normalize(uSunDir + v);
  float glint = pow(max(dot(n, h), 0.0), 220.0);
  col += uSun * glint * 1.4 * smoothstep(-0.05, 0.1, uSunDir.y);
  // Soft painted streaks: low-frequency brightness bands drifting with the ripples.
  col *= 0.96 + 0.06 * sin(p.x * 0.03 + p.y * 0.02 + g.x * 2.0);
  gl_FragColor = vec4(col, 0.86);
  #include <colorspace_fragment>
  #include <fog_fragment>
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uMistColor, mistAmount(vWorld));
}`;

/** One large plane at water level that follows the camera; lakes are wherever terrain dips below it. */
export class Water {
  readonly mesh: THREE.Mesh;
  private readonly u: Record<string, THREE.IUniform>;

  constructor() {
    this.u = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uColor: { value: new THREE.Color() },
        uSky: { value: new THREE.Color() },
        uSun: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3() },
        uTime: { value: 0 },
      },
    ]);
    // Shared (not cloned by merge), so the level's mist reaches the water too.
    Object.assign(this.u, mistUniforms);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u,
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      fog: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat);
    this.mesh.renderOrder = 1; // after terrain so the lakebed shows through near shores
  }

  update(day: DayCycle, cam: THREE.Camera, time: number): void {
    const p = day.palette;
    this.u.uColor.value.copy(p.water);
    this.u.uSky.value.copy(p.skyHorizon);
    this.u.uSun.value.copy(p.sun);
    this.u.uSunDir.value.copy(day.sunDir);
    this.u.uTime.value = time;
    const size = Config.render.drawDistance * 2.2;
    this.mesh.scale.set(size, 1, size);
    this.mesh.position.set(cam.position.x, Config.world.waterLevel, cam.position.z);
  }
}
