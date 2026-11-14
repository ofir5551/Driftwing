import * as THREE from 'three';

/**
 * Light shafts (crepuscular rays) in screen space: each pixel marches toward the sun's screen
 * position and gathers the bright sky it crosses, so light streams round tree crowns, ridges,
 * towers and floating isles. Few, jittered samples and a gentle falloff keep it a soft painted
 * wash rather than hard streaks. Runs in linear HDR before bloom.
 */
export const ShaftsShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uSun: { value: new THREE.Vector2(0.5, 0.5) },
    uColor: { value: new THREE.Color('#fff') },
    uStrength: { value: 0 },
    uThreshold: { value: 0.82 },
    uReach: { value: 0.75 },
    uDecay: { value: 0.95 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uSun;
    uniform vec3 uColor;
    uniform float uStrength;
    uniform float uThreshold;
    uniform float uReach;
    uniform float uDecay;
    varying vec2 vUv;
    float hash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      const int N = 24;
      vec2 delta = (uSun - vUv) / float(N) * 0.9;
      // Jitter the start per pixel: banding turns into fine grain the paper texture hides.
      vec2 p = vUv + delta * hash(vUv * 917.0);
      float acc = 0.0;
      float w = 1.0;
      for (int i = 0; i < N; i++) {
        vec3 c = texture2D(tDiffuse, p).rgb;
        float l = dot(c, vec3(0.299, 0.587, 0.114));
        acc += smoothstep(uThreshold, uThreshold + 0.25, l) * w;
        w *= uDecay;
        p += delta;
      }
      acc /= float(N);
      float fall = 1.0 - smoothstep(0.0, uReach, distance(vUv, uSun));
      gl_FragColor = vec4(base.rgb + uColor * acc * fall * uStrength, base.a);
    }`,
};

/**
 * How much of the shafts to draw for the sun at normalised device coordinates (x, y, z): all
 * of it while the sun is on screen, fading to none 0.8 of a screen beyond the edge, and none
 * when the sun is behind the camera (z > 1). Pure: unit-tested.
 */
export function sunOnScreen(x: number, y: number, z: number): number {
  if (z > 1) return 0;
  const off = Math.max(Math.abs(x), Math.abs(y));
  return 1 - Math.min(1, Math.max(0, off - 1) / 0.8);
}
