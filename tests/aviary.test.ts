import { describe, expect, it } from 'vitest';
import { Journey, UNLOCKS, unlockAt } from '../src/core/Journey';
import { DEFAULT_PLUMAGE, PLUMAGES, plumageDef, type PlumageColors } from '../src/player/Plumage';
import { DEFAULT_TRAIL, TRAILS, trailDef } from '../src/fx/TrailStyle';
import { isLevelId } from '../src/levels';

const HEX = /^#[0-9a-f]{6}$/;

describe('The journey track opens only what exists', () => {
  it('backs every milestone with a level, plumage or trail', () => {
    for (const u of UNLOCKS) {
      const backed =
        (u.kind === 'level' && isLevelId(u.id)) ||
        (u.kind === 'plumage' && PLUMAGES.some((p) => p.unlock === u.id)) ||
        (u.kind === 'trail' && TRAILS.some((t) => t.unlock === u.id));
      expect(backed, `${u.id} opens nothing`).toBe(true);
    }
  });

  it('puts every plumage and trail but the defaults on the track, named as the track names it', () => {
    for (const p of PLUMAGES) {
      if (p.id === DEFAULT_PLUMAGE) {
        expect(p.unlock).toBeNull();
        continue;
      }
      const u = UNLOCKS.find((x) => x.id === p.unlock);
      expect(u?.kind).toBe('plumage');
      expect(u?.name).toBe(`${p.name} plumage`);
    }
    for (const t of TRAILS) {
      if (t.id === DEFAULT_TRAIL) {
        expect(t.unlock).toBeNull();
        continue;
      }
      const u = UNLOCKS.find((x) => x.id === t.unlock);
      expect(u?.kind).toBe('trail');
      expect(u?.name).toBe(`${t.name} trail`);
    }
  });
});

describe('Plumages and trails', () => {
  it('fills every colour role of every plumage with a hex colour', () => {
    const roles = Object.keys(plumageDef(DEFAULT_PLUMAGE).colors) as (keyof PlumageColors)[];
    for (const p of PLUMAGES) {
      expect(Object.keys(p.colors).sort()).toEqual([...roles].sort());
      for (const r of roles) expect(p.colors[r], `${p.id}.${r}`).toMatch(HEX);
    }
    for (const t of TRAILS) {
      expect(t.tip).toMatch(HEX);
      expect(t.tail).toMatch(HEX);
    }
  });

  it('opens the defaults from the start and the rest at their milestones', () => {
    const j = new Journey();
    expect(j.isOpen(plumageDef(DEFAULT_PLUMAGE).unlock)).toBe(true);
    expect(j.isOpen(trailDef(DEFAULT_TRAIL).unlock)).toBe(true);
    const ember = trailDef('ember').unlock!;
    expect(j.isOpen(ember)).toBe(false);
    j.earn(unlockAt(ember));
    expect(j.isOpen(ember)).toBe(true);
    expect(j.isOpen(plumageDef('gilded').unlock)).toBe(false);
  });
});
