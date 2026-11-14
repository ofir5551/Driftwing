import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Config } from '../src/core/Config';
import { shadowFade, snapToTexel } from '../src/fx/SunShadows';
import { cloudShadowStrength } from '../src/world/CloudShadow';
import { blobFrame } from '../src/world/ContactShadows';

/** The light camera's right and up axes for a sun direction (as THREE's lookAt builds them). */
function lightAxes(sun: THREE.Vector3) {
  const m = new THREE.Matrix4().lookAt(sun, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
  const right = new THREE.Vector3().setFromMatrixColumn(m, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(m, 1);
  return { right, up };
}

describe('sun shadows', () => {
  const sun = new THREE.Vector3(0.6, 0.45, -0.66).normalize();
  const texel = 0.15;

  it('snaps the box centre onto the light-space texel grid', () => {
    const { right, up } = lightAxes(sun);
    for (let i = 0; i < 50; i++) {
      const t = new THREE.Vector3(i * 13.7 - 300, 20 + i, i * -9.1 + 50);
      const before = t.clone();
      snapToTexel(t, sun, texel);
      const a = t.dot(right) / texel;
      const b = t.dot(up) / texel;
      expect(Math.abs(a - Math.round(a))).toBeLessThan(1e-6);
      expect(Math.abs(b - Math.round(b))).toBeLessThan(1e-6);
      // Moved by less than a texel, and only across the light (never along it).
      expect(t.distanceTo(before)).toBeLessThan(texel * Math.SQRT2);
      expect(Math.abs(t.clone().sub(before).dot(sun))).toBeLessThan(1e-9);
    }
  });

  it('holds still while the bird moves within a texel (no crawl)', () => {
    const a = snapToTexel(new THREE.Vector3(10, 30, 10), sun, 1);
    const b = snapToTexel(new THREE.Vector3(10.2, 30.1, 10.15), sun, 1);
    const c = snapToTexel(new THREE.Vector3(12, 30, 10), sun, 1);
    expect(b.distanceTo(a)).toBeLessThan(1.5);
    expect(c.distanceTo(a)).toBeGreaterThan(0.5);
  });

  it('copes with a sun straight overhead', () => {
    const t = snapToTexel(new THREE.Vector3(3.33, 5, -7.77), new THREE.Vector3(0, 1, 0), 0.5);
    expect(Number.isFinite(t.x) && Number.isFinite(t.z)).toBe(true);
    expect(t.y).toBe(5);
  });

  it('fades out with a low sun and is full by day', () => {
    expect(shadowFade(-0.2)).toBe(0);
    expect(shadowFade(Config.light.shadowSunMin)).toBe(0);
    expect(shadowFade(Config.light.shadowSunFull)).toBe(1);
    expect(shadowFade(0.9)).toBe(1);
  });

  it('every level has a lighting entry', () => {
    for (const id of [
      'highlands',
      'city',
      'karst',
      'fjord',
      'jerusalem',
      'canyon',
      'peaks',
      'atoll',
      'ringmoon',
    ] as const)
      expect(Config.levelLight[id].shadows).toBeGreaterThanOrEqual(0);
  });
});

describe('contact shadows', () => {
  const out = { y: 0, nx: 0, ny: 0, nz: 0 };

  it('lie on a sloping ground, tilted to it', () => {
    const slope = (x: number) => x * 0.5; // rises 0.5 m per m toward +x
    const f = blobFrame((x) => slope(x), 10, 4.8, 3, 2, out);
    expect(f.y).toBeCloseTo(5);
    // The normal leans away from the uphill side, and is unit length.
    expect(f.nx).toBeLessThan(0);
    expect(f.nz).toBeCloseTo(0);
    expect(Math.hypot(f.nx, f.ny, f.nz)).toBeCloseTo(1);
    expect(f.nx / f.ny).toBeCloseTo(-0.5);
  });

  it('lie flat at the foot of something standing off the ground (a ledge, a roof)', () => {
    const f = blobFrame(() => 0, 0, 30, 0, 2, out);
    expect([f.y, f.nx, f.ny, f.nz]).toEqual([30, 0, 1, 0]);
    expect(blobFrame(null, 0, 7, 0, 2, out).y).toBe(7);
  });
});

describe('cloud shadows', () => {
  it('are off at night and on the horizon, full by day, scaled by level and preset', () => {
    expect(cloudShadowStrength(0.3, 1, -0.5)).toBe(0);
    expect(cloudShadowStrength(0.3, 1, Config.light.cloudSunMin)).toBe(0);
    expect(cloudShadowStrength(0.3, 1, 0.9)).toBeCloseTo(0.3);
    expect(cloudShadowStrength(0.3, 0, 0.9)).toBe(0);
    expect(cloudShadowStrength(0, 1, 0.9)).toBe(0);
  });
});
