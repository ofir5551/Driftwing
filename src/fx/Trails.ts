import * as THREE from 'three';

const N = 14; // points per ribbon (~0.23 s of history: shorter than the camera distance)

const vert = /* glsl */ `
attribute float aT; // 0 at the wingtip, 1 at the tail end
varying float vT;
varying float vDist;
void main() {
  vT = aT;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const frag = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vT;
varying float vDist;
void main() {
  // Fade out as the ribbon nears the lens so it never smears across the camera.
  float a = (1.0 - vT) * (1.0 - vT) * smoothstep(0.0, 0.08, vT) * smoothstep(2.5, 5.5, vDist) * uOpacity;
  gl_FragColor = vec4(uColor, a);
}`;

/**
 * Soft wingtip ribbons. Each ribbon is a ring of recent tip positions turned into a camera-
 * facing triangle strip every frame; width tapers and alpha fades along the length. Opacity
 * follows speed and bank so trails appear in fast swoops and vanish in lazy glides.
 */
class Ribbon {
  readonly mesh: THREE.Mesh;
  private readonly pts = new Float32Array(N * 3);
  private readonly pos: Float32Array;
  private filled = 0;
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly view = new THREE.Vector3();

  constructor(mat: THREE.ShaderMaterial) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(N * 2 * 3);
    const t = new Float32Array(N * 2);
    const idx: number[] = [];
    for (let i = 0; i < N; i++) {
      t[i * 2] = t[i * 2 + 1] = i / (N - 1);
      if (i < N - 1) {
        const k = i * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage),
    );
    g.setAttribute('aT', new THREE.BufferAttribute(t, 1));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }

  push(p: THREE.Vector3): void {
    // Shift history down one slot (N is tiny; copyWithin is a memmove, no allocation).
    this.pts.copyWithin(3, 0, (N - 1) * 3);
    this.pts[0] = p.x;
    this.pts[1] = p.y;
    this.pts[2] = p.z;
    this.filled = Math.min(N, this.filled + 1);
  }

  build(cam: THREE.Vector3, width: number): void {
    const P = this.pts;
    for (let i = 0; i < N; i++) {
      const j = Math.min(i, this.filled - 1);
      // Segment direction from a neighbouring sample (sign is irrelevant for the side vector).
      const nb = j > 0 ? j - 1 : Math.min(1, this.filled - 1);
      this.a.set(P[j * 3], P[j * 3 + 1], P[j * 3 + 2]);
      this.b.set(P[nb * 3], P[nb * 3 + 1], P[nb * 3 + 2]).sub(this.a);
      this.view.copy(cam).sub(this.a);
      this.side.crossVectors(this.b, this.view).normalize();
      if (!Number.isFinite(this.side.x)) this.side.set(0, 1, 0);
      const w = width * (1 - (i / (N - 1)) * 0.7);
      const o = i * 6;
      this.pos[o] = this.a.x + this.side.x * w;
      this.pos[o + 1] = this.a.y + this.side.y * w;
      this.pos[o + 2] = this.a.z + this.side.z * w;
      this.pos[o + 3] = this.a.x - this.side.x * w;
      this.pos[o + 4] = this.a.y - this.side.y * w;
      this.pos[o + 5] = this.a.z - this.side.z * w;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
}

export class Trails {
  readonly group = new THREE.Group();
  private readonly ribbons: Ribbon[];
  private readonly mat: THREE.ShaderMaterial;
  private readonly tmp = new THREE.Vector3();
  private acc = 0;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color('#ffffff') }, uOpacity: { value: 0 } },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.ribbons = [new Ribbon(this.mat), new Ribbon(this.mat)];
    this.group.add(this.ribbons[0].mesh, this.ribbons[1].mesh);
  }

  update(
    dt: number,
    tips: THREE.Object3D[],
    cam: THREE.Vector3,
    intensity: number,
    color: THREE.Color,
  ): void {
    // Sample at a fixed rate so ribbon length (in seconds) is frame-rate independent.
    this.acc += dt;
    const sample = this.acc >= 1 / 60;
    if (sample) this.acc %= 1 / 60;
    for (let i = 0; i < 2; i++) {
      tips[i].getWorldPosition(this.tmp);
      if (sample) this.ribbons[i].push(this.tmp);
      this.ribbons[i].build(cam, 0.05);
    }
    const u = this.mat.uniforms;
    u.uOpacity.value += (intensity - u.uOpacity.value) * Math.min(1, dt * 4);
    u.uColor.value.copy(color);
  }
}
