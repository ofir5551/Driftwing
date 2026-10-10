import * as THREE from 'three';

const vert = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uHalfHeight;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // World-size points: aSize metres projected to pixels.
  gl_PointSize = aSize * projectionMatrix[1][1] * uHalfHeight / max(-mv.z, 0.1);
  vAlpha = aAlpha;
  vColor = aColor;
}`;

const frag = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  float r = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, r);
  a *= a;
  if (a * vAlpha < 0.004) discard;
  gl_FragColor = vec4(vColor, a * vAlpha);
  #include <colorspace_fragment>
}`;

/**
 * Pooled CPU particle system rendered as one Points draw. A ring buffer: emitting overwrites
 * the oldest slot, so there is no allocation and no unbounded growth. Used for sparkles,
 * splashes, dust, celebrations.
 */
export class Particles {
  readonly points: THREE.Points;
  private readonly cap: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly baseSize: Float32Array;
  private readonly gravity: Float32Array;
  private readonly drag: Float32Array;
  private next = 0;
  private readonly mat: THREE.ShaderMaterial;
  /** 0..1 multiplier from the quality preset; low quality emits fewer particles. */
  density = 1;

  constructor(capacity: number, additive: boolean) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity).fill(1);
    this.baseSize = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage),
    );
    g.setAttribute(
      'aColor',
      new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage),
    );
    g.setAttribute(
      'aSize',
      new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage),
    );
    g.setAttribute(
      'aAlpha',
      new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage),
    );
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uHalfHeight: { value: 400 } },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size: number,
    color: THREE.Color,
    gravity = 0,
    drag = 1,
  ): void {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    const k = i * 3;
    this.pos[k] = x;
    this.pos[k + 1] = y;
    this.pos[k + 2] = z;
    this.vel[k] = vx;
    this.vel[k + 1] = vy;
    this.vel[k + 2] = vz;
    this.col[k] = color.r;
    this.col[k + 1] = color.g;
    this.col[k + 2] = color.b;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.baseSize[i] = size;
    this.gravity[i] = gravity;
    this.drag[i] = drag;
  }

  /** Emit `n` particles in a random sphere burst (scaled by density). */
  burst(
    n: number,
    x: number,
    y: number,
    z: number,
    speed: number,
    life: number,
    size: number,
    color: THREE.Color,
    gravity = 0,
    upBias = 0,
  ): void {
    const count = Math.max(1, Math.round(n * this.density));
    for (let i = 0; i < count; i++) {
      // Random direction via normalised gaussian-ish sample (no allocation).
      let dx = Math.random() * 2 - 1;
      let dy = Math.random() * 2 - 1;
      let dz = Math.random() * 2 - 1;
      const l = Math.hypot(dx, dy, dz) || 1;
      const s = speed * (0.4 + Math.random() * 0.6);
      dx = (dx / l) * s;
      dy = (dy / l) * s + upBias;
      dz = (dz / l) * s;
      this.emit(
        x,
        y,
        z,
        dx,
        dy,
        dz,
        life * (0.6 + Math.random() * 0.6),
        size * (0.6 + Math.random() * 0.7),
        color,
        gravity,
        1.5,
      );
    }
  }

  update(dt: number, halfHeightPx: number): void {
    this.mat.uniforms.uHalfHeight.value = halfHeightPx;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = i * 3;
      const damp = Math.exp(-this.drag[i] * dt);
      this.vel[k] *= damp;
      this.vel[k + 1] = this.vel[k + 1] * damp - this.gravity[i] * dt;
      this.vel[k + 2] *= damp;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]); // 1 -> 0
      // Quick fade-in, long fade-out; sparkles shrink slightly as they die.
      this.alpha[i] = Math.min(1, (1 - t) * 8) * t;
      this.size[i] = this.baseSize[i] * (0.5 + 0.5 * t);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
  }
}
