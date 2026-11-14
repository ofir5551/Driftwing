import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Config } from '../src/core/Config';
import { shadowFade, snapToTexel } from '../src/fx/SunShadows';

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
    for (const id of ['highlands', 'city', 'karst', 'fjord', 'jerusalem', 'canyon', 'peaks', 'atoll', 'ringmoon'] as const)
      expect(Config.levelLight[id].shadows).toBeGreaterThanOrEqual(0);
  });
});
