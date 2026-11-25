import * as THREE from 'three';
import { Config } from '../../core/Config';
import { hash2 } from '../noise';
import { VENUE, type EdenLayout } from './EdenLayout';
import { heartPoint } from './heart';

/** What the lanterns write over the venue, a heart between the names. */
const WORDS: readonly [string, string] = ['Tal', 'Hadar'];
/** Most points sampled from the lettering (lanterns drawn). */
const CAP = 1400;

/**
 * "Tal ♥ Hadar" written in lantern light over the venue once the couple are reached: each
 * light rises from the pool and flies to its place in the lettering, left to right as if
 * written, then twinkles there for the rest of the flight. The lettering is sampled from a
 * canvas (browser only: in Node there are no words, and nothing is drawn). Positions are made
 * in the vertex shader from each light's target and delay, so a frame costs one uniform.
 */
export class SkyWords {
  readonly group = new THREE.Group();
  private readonly mat: THREE.ShaderMaterial;
  private readonly geometry: THREE.IcosahedronGeometry;
  /** Seconds since the couple were reached (-1: not yet this flight). */
  private t = -1;

  constructor(layout: EdenLayout) {
    const E = Config.eden;
    this.geometry = new THREE.IcosahedronGeometry(1.05, 1);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uT: { value: -1 },
        uTime: { value: 0 },
        uRise: { value: E.wordsRise },
        uGlow: { value: E.wordsGlow },
        uColor: { value: new THREE.Color('#ff9ab6') },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aTarget;
        attribute vec2 aWhen; // delay (s), seed 0..1
        uniform float uT;
        uniform float uTime;
        uniform float uRise;
        varying float vTwinkle;
        void main() {
          float p = clamp((uT - aWhen.x) / uRise, 0.0, 1.0);
          float e = p * p * (3.0 - 2.0 * p);
          // From the pool, up a loose spiral that tightens as each light finds its place.
          float a = aWhen.y * 6.2832 + p * 5.0;
          vec3 from = vec3(sin(a) * 8.0, 2.0, cos(a) * 8.0);
          vec3 c = mix(from, aTarget, e) + vec3(sin(a), 0.0, cos(a)) * 6.0 * e * (1.0 - e);
          float on = uT < aWhen.x ? 0.0 : 1.0;
          vTwinkle = 0.75 + 0.25 * sin(uTime * 2.6 + aWhen.y * 40.0);
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(c + position * on, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uGlow;
        varying float vTwinkle;
        void main() {
          // Over 1, so bloom haloes each light and the words glow.
          gl_FragColor = vec4(uColor * uGlow * vTwinkle, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const targets = typeof document === 'undefined' ? null : lettering(E.wordsWidth);
    if (!targets) return;
    const n = targets.length / 2;
    const aTarget = new Float32Array(n * 3);
    const aWhen = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = targets[i * 2];
      aTarget[i * 3] = x;
      aTarget[i * 3 + 1] = E.wordsHeight + targets[i * 2 + 1];
      aTarget[i * 3 + 2] = 0;
      // Written left to right, with a little scatter so it shimmers into being.
      const seed = hash2(i, 7, 91);
      aWhen[i * 2] = (x / E.wordsWidth + 0.5) * E.wordsStagger + seed * 0.8;
      aWhen[i * 2 + 1] = seed;
    }
    this.geometry.setAttribute('aTarget', new THREE.InstancedBufferAttribute(aTarget, 3));
    this.geometry.setAttribute('aWhen', new THREE.InstancedBufferAttribute(aWhen, 2));
    const mesh = new THREE.InstancedMesh(this.geometry, this.mat, n);
    mesh.name = 'sky words';
    mesh.frustumCulled = false; // placed in the shader
    // Over the pool, the words facing the way the bird comes in (local x is its right).
    const pool = layout.toWorld(VENUE.pool.u, VENUE.pool.v);
    mesh.position.set(pool.x, layout.venue.y, pool.z);
    mesh.rotation.y = layout.venue.yaw;
    this.group.add(mesh);
    this.group.visible = false;
  }

  /** The couple were reached: the lights begin to rise. */
  start(): void {
    if (this.t < 0) this.t = 0;
    this.group.visible = true;
  }

  /** A new flight: the words wait for the couple again. */
  reset(): void {
    this.t = -1;
    this.group.visible = false;
  }

  frame(dt: number, time: number, stars: number): void {
    if (this.t < 0) return;
    this.t += dt;
    const u = this.mat.uniforms;
    u.uT.value = this.t;
    u.uTime.value = time;
    // Brighter by day: against a bright golden sky dim lights wash out; at night they need less.
    u.uGlow.value = Config.eden.wordsGlow * (1.7 - 0.6 * stars);
  }

  dispose(): void {
    this.geometry.dispose();
    this.mat.dispose();
  }
}

/**
 * The names and a heart drawn on a canvas and sampled on a grid: x, y pairs in metres, centred
 * across `width` and resting on y = 0. Null without a 2D canvas.
 */
function lettering(width: number): Float32Array | null {
  const W = 1600;
  const H = 260;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  g.fillStyle = '#fff';
  g.textBaseline = 'alphabetic';
  g.font = 'italic bold 170px Georgia, "Times New Roman", serif';
  const [a, b] = WORDS;
  const heart = 150;
  const gap = 46;
  const wa = g.measureText(a).width;
  const wb = g.measureText(b).width;
  const total = wa + gap + heart + gap + wb;
  let x = (W - total) / 2;
  const base = 205;
  g.fillText(a, x, base);
  x += wa + gap;
  // The heart, drawn from the same outline as everything else in Eden.
  const pt = { x: 0, y: 0 };
  g.beginPath();
  for (let k = 0; k <= 64; k++) {
    heartPoint(k / 64, pt);
    const hx = x + heart / 2 + (pt.x * heart) / 2;
    const hy = base - 62 - (pt.y * heart) / 2;
    if (k === 0) g.moveTo(hx, hy);
    else g.lineTo(hx, hy);
  }
  g.fill();
  x += heart + gap;
  g.fillText(b, x, base);
  const img = g.getImageData(0, 0, W, H).data;
  // A grid step that keeps the count under the cap, whatever the font's weight.
  let filled = 0;
  for (let i = 3; i < img.length; i += 16) if (img[i] > 128) filled++;
  const step = Math.max(6, Math.ceil(Math.sqrt((filled * 4) / CAP)));
  const pts: number[] = [];
  const m = width / total; // metres per pixel
  for (let py = 0; py < H; py += step)
    for (let px = 0; px < W; px += step)
      if (img[(py * W + px) * 4 + 3] > 128 && pts.length < CAP * 2)
        pts.push((px - W / 2) * m, (base - py) * m);
  return new Float32Array(pts);
}
