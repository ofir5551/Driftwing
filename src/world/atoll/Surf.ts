import * as THREE from 'three';
import { Config } from '../../core/Config';
import { smoothstep } from '../../core/math';
import type { DayCycle } from '../DayCycle';
import { MIST_PARS, mistUniforms } from '../Mist';
import type { Atoll, AtollLayout } from './AtollLayout';

const vert = /* glsl */ `
#include <fog_pars_vertex>
attribute vec3 aFoam;
varying vec3 vFoam;
varying vec3 vWorld;
void main() {
  vFoam = aFoam;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

// Surf on the outer reef: a bright crest line where the swell breaks, and bands of foam that
// roll in over the reef flat and fade. x = metres round the ring, y = 0 on the flat .. 1 out at
// sea, z = 0 in a pass (no reef to break on) .. 1.
const frag = /* glsl */ `
#include <fog_pars_fragment>
${MIST_PARS}
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uGlow;
uniform float uOpacity;
varying vec3 vFoam;
varying vec3 vWorld;
void main() {
  float u = vFoam.x;
  float v = vFoam.y;
  float wob = 0.09 * sin(u * 0.045 + uTime * 0.3) + 0.05 * sin(u * 0.13 - uTime * 0.21);
  // Bands travel inward (toward v = 0) as time runs: each set of foam is a wave that broke.
  float ph = fract(v * 1.7 + uTime * 0.16 + wob);
  float band = smoothstep(0.0, 0.12, ph) * (1.0 - smoothstep(0.2, 0.65, ph)) * (1.0 - 0.45 * v);
  float crestAt = 0.74 + 0.04 * sin(u * 0.07 + uTime * 0.5);
  float crest = exp(-pow((v - crestAt) * 8.0, 2.0)) * (0.75 + 0.25 * sin(uTime * 1.3 + u * 0.05));
  float edge = smoothstep(0.0, 0.3, v) * (1.0 - smoothstep(0.86, 1.0, v));
  float breakup = 0.55 + 0.45 * sin(u * 0.41 + v * 9.0 + uTime * 0.7) * sin(u * 0.17 - uTime * 0.37);
  float a = clamp(max(crest, band * 0.6) * edge * (0.65 + 0.35 * breakup), 0.0, 1.0) * vFoam.z * uOpacity;
  if (a < 0.004) discard;
  // After dark the churned water glows (HDR, picked up by the bloom), brightest in the crest.
  vec3 col = uColor + uGlow * (crest * 0.8 + band * 0.5) * (0.6 + 0.4 * breakup);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
  #include <fog_fragment>
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uMistColor, mistAmount(vWorld));
}`;

const RAISE = 0.07;

/**
 * The surf breaking round every atoll's outer reef, one mesh per atoll in view (built when it
 * comes within draw distance, freed when it leaves), all sharing one animated material.
 */
export class Surf {
  readonly group = new THREE.Group();
  private readonly material: THREE.ShaderMaterial;
  private readonly u: Record<string, THREE.IUniform>;
  private readonly meshes = new Map<Atoll, THREE.Mesh>();
  private readonly seen = new Set<Atoll>();

  constructor(private readonly layout: AtollLayout) {
    this.u = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color() },
        uGlow: { value: new THREE.Color() },
        uOpacity: { value: 1 },
      },
    ]);
    Object.assign(this.u, mistUniforms);
    this.material = new THREE.ShaderMaterial({
      uniforms: this.u,
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      fog: true,
      depthWrite: false,
    });
  }

  /** The foam band of one atoll: three rows round its outer reef. */
  private build(a: Atoll): THREE.Mesh {
    const L = this.layout;
    const n = Math.ceil((Math.PI * 2 * a.R) / 6);
    // Rows across the reef: spent foam on the flat, the crest, the breaking line just outside.
    const rows = [a.w * 0.2, a.w * 0.62, a.w * 0.8 + 6, a.w * 0.8 + 16];
    const vs = [0, 0.45, 0.74, 1];
    const pos = new Float32Array((n + 1) * rows.length * 3);
    const foam = new Float32Array((n + 1) * rows.length * 3);
    let arc = 0;
    let px = 0;
    let pz = 0;
    for (let i = 0; i <= n; i++) {
      const th = (i / n) * Math.PI * 2;
      const R = L.ringR(a, th);
      const sx = Math.sin(th);
      const sz = Math.cos(th);
      const reef = 1 - L.passAt(a, th);
      if (i > 0) arc += Math.hypot(a.x + sx * R - px, a.z + sz * R - pz);
      px = a.x + sx * R;
      pz = a.z + sz * R;
      for (let r = 0; r < rows.length; r++) {
        const o = (i * rows.length + r) * 3;
        pos[o] = a.x + sx * (R + rows[r]);
        pos[o + 1] = RAISE;
        pos[o + 2] = a.z + sz * (R + rows[r]);
        foam[o] = arc;
        foam[o + 1] = vs[r];
        foam[o + 2] = reef * reef;
      }
    }
    const idx: number[] = [];
    const R = rows.length;
    for (let i = 0; i < n; i++)
      for (let r = 0; r < R - 1; r++) {
        const a0 = i * R + r;
        const b0 = (i + 1) * R + r;
        idx.push(a0, a0 + 1, b0, b0, a0 + 1, b0 + 1);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aFoam', new THREE.BufferAttribute(foam, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.material);
    mesh.name = 'surf';
    mesh.renderOrder = 2; // over the water
    return mesh;
  }

  /** Build the surf of atolls coming into view and free that of atolls left behind. */
  update(px: number, pz: number): void {
    const C = Config.atoll.cell;
    const draw = Config.render.drawDistance;
    const seen = this.seen;
    seen.clear();
    const ci = Math.round(px / C);
    const cj = Math.round(pz / C);
    const span = Math.ceil(draw / C) + 1;
    for (let j = cj - span; j <= cj + span; j++)
      for (let i = ci - span; i <= ci + span; i++) {
        const a = this.layout.atoll(i, j);
        if (!a || Math.hypot(a.x - px, a.z - pz) > draw + a.R + a.w + 40) continue;
        seen.add(a);
        if (!this.meshes.has(a)) {
          const mesh = this.build(a);
          this.meshes.set(a, mesh);
          this.group.add(mesh);
        }
      }
    this.meshes.forEach(this.drop);
  }

  /** Free an atoll's surf if it was not seen this frame (bound once: frames never allocate). */
  private readonly drop = (mesh: THREE.Mesh, a: Atoll): void => {
    if (this.seen.has(a)) return;
    this.group.remove(mesh);
    mesh.geometry.dispose();
    this.meshes.delete(a);
  };

  frame(time: number, day: DayCycle): void {
    const p = day.palette;
    const night = smoothstep(0.2, 0.85, p.stars);
    // Foam takes the light of the hour: sunlit white by day, dim and cool at night.
    this.u.uColor.value
      .copy(p.hemiSky)
      .lerp(p.sun, 0.25)
      .multiplyScalar(0.9 + 0.25 * (1 - night));
    this.u.uColor.value.lerp(p.fog, 0.15);
    this.u.uGlow.value.setRGB(0.25, 1.35, 1.6).multiplyScalar(night * Config.atoll.glow);
    this.u.uOpacity.value = Config.atoll.surf;
    this.u.uTime.value = time;
  }

  dispose(): void {
    for (const mesh of this.meshes.values()) mesh.geometry.dispose();
    this.meshes.clear();
    this.material.dispose();
  }
}
