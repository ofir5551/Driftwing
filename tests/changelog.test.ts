import { describe, expect, it } from 'vitest';
import {
  CHANGELOG,
  VERSION,
  compareVersions,
  formatDate,
  seenVersion,
  unseen,
} from '../src/core/Changelog';
import pkg from '../package.json';

describe('changelog', () => {
  it('is the version in package.json', () => {
    expect(VERSION).toBe(pkg.version);
  });

  it('runs newest first, with well-formed, distinct versions and dates', () => {
    for (const e of CHANGELOG) {
      expect(e.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.items.length).toBeGreaterThan(0);
    }
    for (let i = 1; i < CHANGELOG.length; i++) {
      expect(compareVersions(CHANGELOG[i - 1].version, CHANGELOG[i].version)).toBeGreaterThan(0);
      expect(CHANGELOG[i - 1].date >= CHANGELOG[i].date).toBe(true);
    }
  });

  it('compares versions by number, not text', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '0.99.9')).toBeGreaterThan(0);
    expect(compareVersions('0.7.1', '0.7.1')).toBe(0);
    expect(compareVersions('0.7.0', '0.7.1')).toBeLessThan(0);
  });

  it('lists only the releases newer than the one last seen', () => {
    expect(unseen(VERSION)).toEqual([]);
    expect(unseen(CHANGELOG[1].version)).toEqual([CHANGELOG[0]]);
    expect(unseen('0.0.0')).toHaveLength(CHANGELOG.length);
  });

  it('announces nothing to a new player and this release to an old one', () => {
    expect(unseen(seenVersion(null, false))).toEqual([]);
    expect(unseen(seenVersion(null, true)).map((e) => e.version)).toContain(VERSION);
    expect(seenVersion('garbage', false)).toBe(VERSION);
    expect(seenVersion('0.5.0', true)).toBe('0.5.0');
  });

  it('formats dates the same everywhere', () => {
    expect(formatDate('2026-11-26')).toBe('26 Nov 2026');
  });
});
