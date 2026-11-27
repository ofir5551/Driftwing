import * as THREE from 'three';
import { Config } from '../../core/Config';
import { smoothstep } from '../../core/math';
import type { DayCycle } from '../DayCycle';
import { mulberry32 } from '../noise';

/**
 * Maple leaves falling round the bird: one draw of small quads in a box that wraps round the
 * camera (each leaf's place is its seed plus its fall and drift, taken modulo the box, so the
 * air is always full and nothing is ever moved on the CPU). Each leaf tumbles and flutters
 * from side to side as it falls, cut to a five-lobed maple silhouette in the fragment shader,
 * in crimson, flame or gold, lit by the hour, fading toward the box's edge. The count follows
 * the ground cover's density (fewer on medium, a few on low).
 */

const vert = /* glsl */ `
attribute vec4 aSeed;
attribute vec2 aCorner;
uniform vec3 uCam;
uniform float uTime;
uniform float uRange;
uniform float uFall;
uniform float uSize;
uniform vec2 uWind;
varying vec2 vUv;
varying float vFade;
varying float vHue;
varying float vSide;
void main() {
  float t = uTime;
  vec3 p = aSeed.xyz * uRange;
  float speed = 0.7 + 0.6 * aSeed.w;
  p.y -= t * uFall * speed;
  p.xz += uWind * t * (0.8 + 0.4 * aSeed.w);
  // Flutter: a leaf swings side to side as it falls, a little more the slower it falls.
  float ph = aSeed.w * 6.2831 + t * (1.4 + aSeed.x * 0.8);
  p.x += sin(ph) * 1.4 / speed;
  p.z += cos(ph * 0.8 + 1.7) * 1.0 / speed;
  // Wrap into the box round the camera.
  vec3 rel = mod(p - uCam + uRange * 0.5, uRange) - uRange * 0.5;
  vec3 world = uCam + rel;
  // Tumble: turn the quad in its own plane and about its long axis.
  float a = t * (1.6 + 2.6 * aSeed.y) + aSeed.w * 10.0;
  float b = t * (1.1 + 1.8 * aSeed.z) + aSeed.x * 6.0;
  vec3 c = vec3(aCorner * uSize * (0.75 + 0.5 * aSeed.z), 0.0);
  c.xy = mat2(cos(a), -sin(a), sin(a), cos(a)) * c.xy;
  c.yz = mat2(cos(b), -sin(b), sin(b), cos(b)) * c.yz;
  gl_Position = projectionMatrix * viewMatrix * vec4(world + c, 1.0);
  vUv = aCorner;
  // Fade toward the box's edge, and out right in front of the lens (no leaf fills the view).
  float dc = distance(world, cameraPosition);
  vFade = (1.0 - smoothstep(uRange * 0.28, uRange * 0.48, length(rel))) * smoothstep(3.5, 8.0, dc);
  vHue = fract(aSeed.x * 7.13 + aSeed.z * 3.7);
  // The face turned to the light is brighter than its back.
  vSide = 0.75 + 0.25 * cos(b);
}`;

const frag = /* glsl */ `
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uColC;
uniform vec3 uLight;
varying vec2 vUv;
varying float vFade;
varying float vHue;
varying float vSide;
void main() {
  // A maple leaf: five pointed lobes round a stalk, the bottom lobes shorter.
  vec2 q = vUv;
  float r = length(q);
  float th = atan(q.x, q.y);
  float lobes = pow(abs(cos(th * 2.5)), 1.6);
  float edge = (0.2 + 0.3 * lobes) * (1.0 - 0.35 * smoothstep(1.6, 3.0, abs(th)));
  if (r > edge || vFade <= 0.0) discard;
  vec3 c = vHue < 0.5 ? mix(uColA, uColB, vHue * 2.0) : mix(uColB, uColC, vHue * 2.0 - 1.0);
  // Veins: a little darker along the lobes' midlines.
  c *= 0.85 + 0.15 * smoothstep(0.0, 0.12, abs(sin(th * 2.5)) * r);
  gl_FragColor = vec4(c * uLight * vSide, vFade);
  #include <colorspace_fragment>
}`;

export class Leaves {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly max: number;
  private readonly light = new THREE.Color();
  private readonly sun = new THREE.Color();

  constructor(seed: number) {
    const K = Config.maple;
    const n = (this.max = K.leaves);
    const rand = mulberry32(seed * 13 + 5);
    const seeds = new Float32Array(n * 4 * 4);
    const corners = new Float32Array(n * 4 * 2);
    const index: number[] = [];
    const C = [-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5];
    for (let i = 0; i < n; i++) {
      const s = [rand(), rand(), rand(), rand()];
      for (let v = 0; v < 4; v++) {
        seeds.set(s, (i * 4 + v) * 4);
        corners[(i * 4 + v) * 2] = C[v * 2];
        corners[(i * 4 + v) * 2 + 1] = C[v * 2 + 1];
      }
      const b = i * 4;
      index.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const g = new THREE.BufferGeometry();
    // Positions only bound the draw; the shader places every leaf.
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 4 * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    g.setAttribute('aCorner', new THREE.BufferAttribute(corners, 2));
    g.setIndex(index);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uCam: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        uRange: { value: K.leafRange },
        uFall: { value: K.leafFall },
        uSize: { value: K.leafSize },
        uWind: { value: new THREE.Vector2(0.8, 0.4) },
        uColA: { value: new THREE.Color('#c8302a') },
        uColB: { value: new THREE.Color('#e7742a') },
        uColC: { value: new THREE.Color('#f0c23e') },
        uLight: { value: new THREE.Color(1, 1, 1) },
      },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'leaves';
    const u = this.material.uniforms;
    this.mesh.onBeforeRender = (_r, _s, camera) => u.uCam.value.copy(camera.position);
  }

  frame(time: number, day: DayCycle): void {
    const u = this.material.uniforms;
    const K = Config.maple;
    u.uTime.value = time;
    u.uRange.value = K.leafRange;
    u.uFall.value = K.leafFall;
    u.uSize.value = K.leafSize;
    // Lit by the sky's light and the sun's (dim at night, when only the near ones show).
    const p = day.palette;
    const sun = smoothstep(-0.05, 0.25, day.sunDir.y) * p.sunIntensity;
    this.light.copy(p.hemiSky).multiplyScalar(p.hemiIntensity * 0.6);
    this.light.add(this.sun.copy(p.sun).multiplyScalar(sun * 0.75));
    u.uLight.value.copy(this.light);
    const share = Math.max(0.25, Config.render.coverDensity);
    this.mesh.geometry.setDrawRange(0, Math.floor(this.max * share) * 6);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
