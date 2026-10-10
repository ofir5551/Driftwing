import * as THREE from 'three';

const COUNT = 260;
const BOX = 70; // m, size of the wrapping box of air motes around the camera

// Air motes fixed in world space, wrapped into a box around the camera in the vertex shader.
// At cruise they are faint drifting specks; at speed each stretches into a streak along the
// flight direction, which sells velocity far better than any number on screen.
const vert = /* glsl */ `
attribute vec3 aBase;
uniform vec3 uCam;
uniform vec3 uVel;
uniform float uStretch;
uniform float uTime;
varying float vAlpha;
varying float vAlong;
void main() {
  vec3 drift = vec3(sin(uTime * 0.3 + aBase.y), cos(uTime * 0.23 + aBase.x) * 0.5, sin(uTime * 0.27 + aBase.z)) * 2.0;
  vec3 rel = mod(aBase + drift - uCam + ${BOX / 2}.0, ${BOX}.0) - ${BOX / 2}.0;
  vec3 center = uCam + rel;
  // position.x in [-0.5, 0.5] spans the streak length; position.y its tiny width.
  vec3 dir = length(uVel) > 0.01 ? normalize(uVel) : vec3(0.0, 0.0, 1.0);
  vec3 toCam = normalize(uCam - center);
  vec3 side = normalize(cross(dir, toCam));
  vec3 wp = center + dir * position.x * (0.15 + uStretch) + side * position.y * 0.05;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  float d = length(rel);
  vAlpha = smoothstep(${BOX / 2}.0, ${BOX / 2 - 12}.0, d) * smoothstep(2.0, 6.0, d);
  vAlong = position.x + 0.5;
}`;
const frag = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
varying float vAlong;
void main() {
  float a = vAlpha * uOpacity * sin(vAlong * 3.14159);
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
}`;

export class Wind {
  readonly mesh: THREE.InstancedMesh;
  private readonly u: Record<string, THREE.IUniform>;

  constructor() {
    const geo = new THREE.PlaneGeometry(1, 1);
    const base = new Float32Array(COUNT * 3);
    for (let i = 0; i < base.length; i++) base[i] = Math.random() * BOX * 4;
    geo.setAttribute('aBase', new THREE.InstancedBufferAttribute(base, 3));
    this.u = {
      uCam: { value: new THREE.Vector3() },
      uVel: { value: new THREE.Vector3() },
      uStretch: { value: 0 },
      uTime: { value: 0 },
      uColor: { value: new THREE.Color('#ffffff') },
      uOpacity: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u,
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, COUNT);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }

  /** speedT: 0 at cruise, 1 at max speed. */
  update(
    cam: THREE.Vector3,
    vel: THREE.Vector3,
    speedT: number,
    time: number,
    color: THREE.Color,
    density: number,
  ): void {
    this.u.uCam.value.copy(cam);
    this.u.uVel.value.copy(vel);
    this.u.uStretch.value = speedT * 5;
    this.u.uTime.value = time;
    this.u.uColor.value.copy(color);
    this.u.uOpacity.value = 0.12 + speedT * 0.4;
    this.mesh.count = Math.round(COUNT * density);
  }
}
