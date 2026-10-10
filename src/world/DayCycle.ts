import * as THREE from 'three';
import { smoothstep } from '../core/math';

/**
 * Palette-driven time of day. A phase in [0, 1) walks through keyframes
 * dawn -> day -> golden hour -> dusk -> twilight -> (wraps to) dawn, and every visual system
 * (sky, fog, lights, post grade, water, wisp glow) reads the blended palette.
 */
export interface Palette {
  skyTop: THREE.Color;
  skyHorizon: THREE.Color;
  skyBottom: THREE.Color;
  fog: THREE.Color;
  sun: THREE.Color;
  sunIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  sunElevation: number; // radians above horizon
  stars: number; // 0..1
  grade: THREE.Color; // multiplicative colour grade in the post pass
  water: THREE.Color;
}

interface Key {
  t: number;
  name: string;
  p: Palette;
}

const pal = (o: {
  skyTop: string;
  skyHorizon: string;
  skyBottom: string;
  fog: string;
  sun: string;
  sunIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  sunElevation: number;
  stars: number;
  grade: string;
  water: string;
}): Palette => ({
  ...o,
  skyTop: new THREE.Color(o.skyTop),
  skyHorizon: new THREE.Color(o.skyHorizon),
  skyBottom: new THREE.Color(o.skyBottom),
  fog: new THREE.Color(o.fog),
  sun: new THREE.Color(o.sun),
  hemiSky: new THREE.Color(o.hemiSky),
  hemiGround: new THREE.Color(o.hemiGround),
  grade: new THREE.Color(o.grade),
  water: new THREE.Color(o.water),
});

const KEYS: Key[] = [
  {
    t: 0,
    name: 'dawn',
    p: pal({
      skyTop: '#8fa6d6',
      skyHorizon: '#f6c6b4',
      skyBottom: '#d9b3c0',
      fog: '#ecc4bc',
      sun: '#ffc9a0',
      sunIntensity: 1.6,
      hemiSky: '#c9c4ec',
      hemiGround: '#8a6f84',
      hemiIntensity: 1.3,
      sunElevation: 0.12,
      stars: 0.15,
      grade: '#fff0ee',
      water: '#9db5d6',
    }),
  },
  {
    t: 0.22,
    name: 'day',
    p: pal({
      skyTop: '#6fa3dc',
      skyHorizon: '#d8ecf2',
      skyBottom: '#bcd6dc',
      fog: '#cfe3ea',
      sun: '#fff3dc',
      sunIntensity: 2.2,
      hemiSky: '#d4ecff',
      hemiGround: '#7f8f6a',
      hemiIntensity: 1.5,
      sunElevation: 0.95,
      stars: 0,
      grade: '#ffffff',
      water: '#7fb4cf',
    }),
  },
  {
    t: 0.48,
    name: 'golden',
    p: pal({
      skyTop: '#7f98cf',
      skyHorizon: '#ffd39a',
      skyBottom: '#f0c08f',
      fog: '#f6cf9f',
      sun: '#ffc070',
      sunIntensity: 2.4,
      hemiSky: '#ffe2bc',
      hemiGround: '#8a6a55',
      hemiIntensity: 1.25,
      sunElevation: 0.22,
      stars: 0,
      grade: '#fff2de',
      water: '#c9a98f',
    }),
  },
  {
    t: 0.68,
    name: 'dusk',
    p: pal({
      skyTop: '#4e4f8f',
      skyHorizon: '#f29a8c',
      skyBottom: '#b4789a',
      fog: '#c98f9a',
      sun: '#ff9277',
      sunIntensity: 1.5,
      hemiSky: '#b29ad6',
      hemiGround: '#5a4560',
      hemiIntensity: 1.15,
      sunElevation: 0.04,
      stars: 0.55,
      grade: '#fbe6f0',
      water: '#8a7aa8',
    }),
  },
  {
    t: 0.84,
    name: 'twilight',
    p: pal({
      skyTop: '#2b3266',
      skyHorizon: '#8a74ae',
      skyBottom: '#5e5684',
      fog: '#6f6496',
      sun: '#b7a6ff',
      sunIntensity: 0.9,
      hemiSky: '#8f8fd0',
      hemiGround: '#3d3a58',
      hemiIntensity: 1.15,
      sunElevation: 0.35, // read as the moon: a soft cool light from above
      stars: 1,
      grade: '#e8e6ff',
      water: '#4d5a8f',
    }),
  },
];

export class DayCycle {
  readonly palette: Palette = pal({
    skyTop: '#000',
    skyHorizon: '#000',
    skyBottom: '#000',
    fog: '#000',
    sun: '#000',
    sunIntensity: 0,
    hemiSky: '#000',
    hemiGround: '#000',
    hemiIntensity: 0,
    sunElevation: 0,
    stars: 0,
    grade: '#000',
    water: '#000',
  });
  /** Unit vector toward the sun (or moon at night). */
  readonly sunDir = new THREE.Vector3();
  phase: number;
  /** Index of the current keyframe; Music uses it to drift key/mode. */
  keyIndex = 0;

  constructor(phase = 0.08) {
    this.phase = phase;
    this.apply();
  }

  get name(): string {
    return KEYS[this.keyIndex].name;
  }

  update(dt: number, dayLength: number): void {
    this.phase = (this.phase + dt / dayLength) % 1;
    this.apply();
  }

  setPhase(p: number): void {
    this.phase = ((p % 1) + 1) % 1;
    this.apply();
  }

  private apply(): void {
    let i = KEYS.length - 1;
    for (let k = 0; k < KEYS.length; k++) if (KEYS[k].t <= this.phase) i = k;
    const a = KEYS[i];
    const b = KEYS[(i + 1) % KEYS.length];
    const span = (b.t > a.t ? b.t : b.t + 1) - a.t;
    // Hold each look for the first part of its span, then ease into the next: the day feels
    // like distinct moods rather than a constant slide.
    const f = smoothstep(0.35, 1, (this.phase - a.t) / span);
    this.keyIndex = f < 0.5 ? i : (i + 1) % KEYS.length;
    const P = this.palette;
    const A = a.p;
    const B = b.p;
    P.skyTop.lerpColors(A.skyTop, B.skyTop, f);
    P.skyHorizon.lerpColors(A.skyHorizon, B.skyHorizon, f);
    P.skyBottom.lerpColors(A.skyBottom, B.skyBottom, f);
    P.fog.lerpColors(A.fog, B.fog, f);
    P.sun.lerpColors(A.sun, B.sun, f);
    P.hemiSky.lerpColors(A.hemiSky, B.hemiSky, f);
    P.hemiGround.lerpColors(A.hemiGround, B.hemiGround, f);
    P.grade.lerpColors(A.grade, B.grade, f);
    P.water.lerpColors(A.water, B.water, f);
    P.sunIntensity = A.sunIntensity + (B.sunIntensity - A.sunIntensity) * f;
    P.hemiIntensity = A.hemiIntensity + (B.hemiIntensity - A.hemiIntensity) * f;
    P.sunElevation = A.sunElevation + (B.sunElevation - A.sunElevation) * f;
    P.stars = A.stars + (B.stars - A.stars) * f;
    // The sun swings across the sky over the cycle; azimuth chosen so golden hour is backlit-ish.
    const az = 0.6 + this.phase * Math.PI * 1.2;
    const el = P.sunElevation;
    this.sunDir
      .set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az))
      .normalize();
  }
}
