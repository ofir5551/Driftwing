import * as THREE from 'three';
import { Config } from '../../core/Config';
import { smoothstep } from '../../core/math';
import type { DayCycle } from '../DayCycle';
import { mulberry32 } from '../noise';

/** Geese in a flock's V (the leader and pairs trailing back either side). */
const V = 11;
/** m: the box round the camera the flocks wrap in (their pop is out in the haze). */
const RANGE = 2200;

const vert = /* glsl */ `
attribute vec4 aFlock;
attribute vec3 aGoose;
uniform vec3 uCam;
uniform float uTime;
uniform float uSpeed;
uniform float uHeight;
uniform vec2 uDir;
varying float vFade;
varying float vDist;
void main() {
  // Each flock's heading: the season's way south, turned a little.
  float turn = (aFlock.w - 0.5) * 0.5;
  vec2 d = vec2(uDir.x * cos(turn) - uDir.y * sin(turn), uDir.x * sin(turn) + uDir.y * cos(turn));
  vec2 p = aFlock.xy * ${RANGE.toFixed(1)} + d * uTime * uSpeed * (0.85 + 0.3 * aFlock.z);
  vec2 rel = mod(p - uCam.xz + ${(RANGE / 2).toFixed(1)}, ${RANGE.toFixed(1)}) - ${(RANGE / 2).toFixed(1)};
  vec3 world = vec3(uCam.x + rel.x, uHeight + (aFlock.z - 0.5) * 60.0, uCam.z + rel.y);
  // The goose's wingbeat (each its own phase) and a slow rise and fall of the whole line.
  vec3 v = position;
  float ph = aGoose.y * 1.7 + aFlock.w * 20.0;
  v.y += sin(uTime * 4.2 + ph) * aGoose.x * 0.7;
  world.y += sin(uTime * 0.4 + aGoose.y * 0.5 + aFlock.z * 9.0) * 1.5;
  // Turn local (x across, z forward) to the heading.
  world += vec3(v.x * d.y + v.z * d.x, v.y, -v.x * d.x + v.z * d.y);
  vec4 mv = viewMatrix * vec4(world, 1.0);
  vDist = -mv.z;
  vFade = 1.0 - smoothstep(${(RANGE * 0.3).toFixed(1)}, ${(RANGE * 0.47).toFixed(1)}, length(rel));
  gl_Position = projectionMatrix * mv;
}`;

const frag = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uFog;
uniform float uFogFar;
varying float vFade;
varying float vDist;
void main() {
  vec3 c = mix(uColor, uFog, smoothstep(uFogFar * 0.2, uFogFar * 1.1, vDist));
  gl_FragColor = vec4(c, vFade);
  #include <colorspace_fragment>
}`;

/**
 * Wild geese crossing high over the valley in V lines, all on their way south: a few flocks
 * in a box that wraps round the camera (each flock's place is its seed plus its flight, taken
 * modulo the box), every goose beating its own wings, the line rising and falling a little.
 * Dark silhouettes against the sky, fading into the haze with distance; one draw, nothing
 * moved on the CPU.
 */
export class Geese {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(seed: number) {
    const K = Config.maple;
    const rand = mulberry32(seed * 7 + 11);
    // One goose: a body diamond and two swept wings, ~3.6 m across (bigger than life, so a
    // flock reads from far below), facing +z. aGoose: (wing weight, index in the V).
    const goose: number[] = [];
    const wing: number[] = [];
    const tri = (pts: number[], w: number[]) => {
      goose.push(...pts);
      wing.push(...w);
    };
    tri([0, 0, 0.9, 0.16, 0, 0, -0.16, 0, 0], [0, 0, 0]);
    tri([0.16, 0, 0, 0, 0, -0.8, -0.16, 0, 0], [0, 0, 0]);
    for (const s of [-1, 1]) tri([0, 0, 0.25, s * 1.25, 0, -0.35, 0, 0, -0.25], [0, 1, 0]);
    // Larger than life (a flock must read from far below).
    for (let i = 0; i < goose.length; i++) goose[i] *= 1.5;
    const per = goose.length / 3;
    const pos: number[] = [];
    const gAttr: number[] = [];
    for (let i = 0; i < V; i++) {
      const k = Math.ceil(i / 2);
      const side = i === 0 ? 0 : i % 2 ? 1 : -1;
      const ox = side * k * 3.9;
      const oz = -k * 3.6;
      for (let v = 0; v < per; v++) {
        pos.push(goose[v * 3] + ox, goose[v * 3 + 1], goose[v * 3 + 2] + oz);
        gAttr.push(wing[v], i, 0);
      }
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aGoose', new THREE.Float32BufferAttribute(gAttr, 3));
    const n = K.geese;
    const flocks = new Float32Array(n * 4);
    for (let i = 0; i < n * 4; i++) flocks[i] = rand();
    g.setAttribute('aFlock', new THREE.InstancedBufferAttribute(flocks, 4));
    g.instanceCount = n;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uCam: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        uSpeed: { value: K.geeseSpeed },
        uHeight: { value: K.geeseHeight },
        uDir: { value: new THREE.Vector2(-0.55, -0.83) },
        uColor: { value: new THREE.Color('#3a3236') },
        uFog: { value: new THREE.Color() },
        uFogFar: { value: 1000 },
      },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'geese';
    const u = this.material.uniforms;
    this.mesh.onBeforeRender = (_r, _s, camera) => u.uCam.value.copy(camera.position);
  }

  frame(time: number, day: DayCycle): void {
    const u = this.material.uniforms;
    const K = Config.maple;
    u.uTime.value = time;
    u.uSpeed.value = K.geeseSpeed;
    u.uHeight.value = K.geeseHeight;
    u.uFog.value.copy(day.palette.fog);
    u.uFogFar.value = Config.render.drawDistance;
    // Lit a little by the sky by day; at night only the moon's faint dark shapes.
    const lit = smoothstep(-0.05, 0.3, day.sunDir.y);
    u.uColor.value.setRGB(0.12, 0.1, 0.11).lerp(day.palette.hemiGround, 0.25 * lit);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
