import * as THREE from 'three';

/**
 * Final painterly pass: soft edge wobble (hand-drawn feel), colour grade, gentle saturation,
 * warm lifted shadows, canvas weave + paper grain, and a soft vignette. Runs after bloom,
 * before the OutputPass does tone mapping / sRGB conversion.
 */
export const PainterlyShader = {
  name: 'PainterlyShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tPaper: { value: null as THREE.Texture | null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uGrade: { value: new THREE.Color(1, 1, 1) },
    uShadowTint: { value: new THREE.Color(0.5, 0.45, 0.6) },
    uSaturation: { value: 1.08 },
    uGrain: { value: 0.05 },
    uVignette: { value: 0.32 },
    uWobble: { value: 1.0 },
    uFlash: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tPaper;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform vec3 uGrade;
    uniform vec3 uShadowTint;
    uniform float uSaturation;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uWobble;
    uniform float uFlash;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

    void main() {
      // Paper texture is sampled in screen pixels so its grain size is resolution independent.
      vec2 paperUv = gl_FragCoord.xy / 512.0;
      vec4 paper = texture2D(tPaper, paperUv);
      // Wobble: nudge the lookup by a pixel or two along the paper fibres; silhouettes become
      // slightly irregular, like edges painted by hand.
      vec2 wob = (paper.gb - 0.5) * uWobble * 2.2 / uResolution;
      vec3 col = texture2D(tDiffuse, vUv + wob).rgb;

      // Grade: multiply by the time-of-day tint, then tint the shadows (never pure grey/black).
      col *= uGrade;
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, col * 0.6 + uShadowTint * 0.4, (1.0 - smoothstep(0.0, 0.45, lum)) * 0.35);
      lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(lum), col, uSaturation);
      // Soft shoulder so bloom highlights roll off instead of clipping.
      col = col / (1.0 + max(col - 0.85, 0.0) * 0.8);

      // Canvas: paper fibre texture plus a little animated grain.
      float fibre = (paper.r - 0.5);
      float grain = hash(gl_FragCoord.xy + fract(uTime * 7.0) * 113.0) - 0.5;
      col *= 1.0 + fibre * uGrain * 1.4 + grain * uGrain * 0.5;

      // Vignette: soft and slightly warm.
      vec2 d = vUv - 0.5;
      d.x *= uResolution.x / uResolution.y;
      float vig = smoothstep(0.35, 1.05, length(d));
      col = mix(col, col * vec3(0.78, 0.72, 0.8), vig * uVignette * 1.6);

      col += uFlash * vec3(1.0, 0.95, 0.85) * 0.25;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

/** Tiny procedural "paper": R = fibre brightness, GB = smooth offsets used for edge wobble. */
export function createPaperTexture(size = 256): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const rnd = (x: number, y: number) => {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  // Value noise helper with wrap-around so the texture tiles seamlessly.
  const vnoise = (x: number, y: number, period: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const w = (a: number) => ((a % period) + period) % period;
    const a = rnd(w(xi), w(yi));
    const b = rnd(w(xi + 1), w(yi));
    const c = rnd(w(xi), w(yi + 1));
    const e = rnd(w(xi + 1), w(yi + 1));
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + e) * u * v;
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const fine = rnd(x, y);
      const fibres = vnoise(x / 2, y / 9, size / 2) * 0.5 + vnoise(x / 9, y / 2, size / 9) * 0.5;
      const blot = vnoise(x / 32, y / 32, size / 32);
      const r = 0.5 + (fine - 0.5) * 0.35 + (fibres - 0.5) * 0.45 + (blot - 0.5) * 0.3;
      const i = (y * size + x) * 4;
      data[i] = Math.round(Math.min(1, Math.max(0, r)) * 255);
      data[i + 1] = Math.round(vnoise(x / 16, y / 16, size / 16) * 255);
      data[i + 2] = Math.round(vnoise(x / 16 + 7.3, y / 16 + 3.1, size / 16) * 255);
      data[i + 3] = 255;
    }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
