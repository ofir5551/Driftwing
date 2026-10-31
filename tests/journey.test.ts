import { afterEach, describe, expect, it } from 'vitest';
import { Config } from '../src/core/Config';
import { Journey, parseJourney, UNLOCKS, unlockAt } from '../src/core/Journey';
import { isLevelId, LEVEL_LIST } from '../src/levels';

const saved = { ...Config.unlocks };
afterEach(() => Object.assign(Config.unlocks, saved));

describe('Journey', () => {
  it('starts with nothing open and the first milestone next', () => {
    const j = new Journey();
    expect(j.light).toBe(0);
    expect(j.next()?.id).toBe('emberTrail');
    expect(j.fraction()).toBe(0);
    expect(UNLOCKS.some((u) => j.isUnlocked(u.id))).toBe(false);
  });

  it('opens a milestone exactly once, when its light is reached', () => {
    const j = new Journey();
    const at = unlockAt('emberTrail');
    expect(j.earn(at - 1)).toHaveLength(0);
    expect(j.isUnlocked('emberTrail')).toBe(false);
    const opened = j.earn(1);
    expect(opened.map((u) => u.id)).toEqual(['emberTrail']);
    expect(j.isUnlocked('emberTrail')).toBe(true);
    expect(j.earn(1)).toHaveLength(0);
    expect(j.next()?.id).toBe('city');
  });

  it('reports several milestones crossed at once, lowest first', () => {
    const j = new Journey();
    const opened = j.earn(unlockAt('karst'));
    expect(opened.map((u) => u.id)).toEqual(['emberTrail', 'city', 'duskRosePlumage', 'karst']);
  });

  it('never earns from zero, negative or NaN amounts', () => {
    const j = new Journey();
    for (const a of [0, -50, Number.NaN]) j.earn(a);
    expect(j.light).toBe(0);
    expect(j.dirty).toBe(false);
  });

  it('measures progress between the last milestone passed and the next', () => {
    const j = new Journey();
    const a = unlockAt('emberTrail');
    const b = unlockAt('city');
    j.earn(a + (b - a) / 2);
    expect(j.fraction()).toBeCloseTo(0.5, 5);
    j.earn(1e6);
    expect(j.next()).toBeNull();
    expect(j.fraction()).toBe(1);
  });

  it('tracks the light of the current flight separately', () => {
    const j = new Journey({ v: 1, light: 500, granted: [], revealed: [] });
    j.earn(12);
    expect(j.flightLight).toBe(12);
    j.newFlight();
    expect(j.flightLight).toBe(0);
    expect(j.light).toBe(512);
  });

  it('keeps an unlock when a retune raises its threshold above the light', () => {
    const j = new Journey();
    j.earn(unlockAt('city'));
    Config.unlocks.city = 10_000;
    const back = new Journey(parseJourney(JSON.parse(JSON.stringify(j.toData()))));
    expect(back.isUnlocked('city')).toBe(true);
    expect(back.next()?.id).toBe('duskRosePlumage');
  });

  it('quietly opens milestones a retune lowered below the saved light', () => {
    Config.unlocks.crane = 5;
    const j = new Journey({ v: 1, light: 10, granted: [], revealed: [] });
    expect(j.isUnlocked('crane')).toBe(true);
    expect(j.dirty).toBe(true);
  });

  it('grants levels flown before the journey, ignoring unknown ids and the Highlands', () => {
    const j = new Journey();
    expect(j.grant('fjord')).toBe(true);
    expect(j.grant('fjord')).toBe(false);
    expect(j.grant('highlands')).toBe(false);
    expect(j.grant('nonsense')).toBe(false);
    expect(j.isUnlocked('fjord')).toBe(true);
    expect(j.next()?.id).toBe('emberTrail');
  });

  it('round-trips through its saved form', () => {
    const j = new Journey();
    j.earn(800);
    j.grant('canyon');
    const back = new Journey(parseJourney(JSON.parse(JSON.stringify(j.toData()))));
    expect(back.light).toBe(800);
    for (const u of UNLOCKS) expect(back.isUnlocked(u.id)).toBe(j.isUnlocked(u.id));
  });
});

describe('Journey / level locks', () => {
  it('opens only the Highlands at first', () => {
    const j = new Journey();
    expect(LEVEL_LIST.filter((l) => j.isLevelOpen(l.id)).map((l) => l.id)).toEqual([
      'highlands',
    ]);
  });

  it('opens each level at its milestone, in order', () => {
    const j = new Journey();
    j.earn(unlockAt('karst'));
    expect(LEVEL_LIST.filter((l) => j.isLevelOpen(l.id)).map((l) => l.id)).toEqual([
      'highlands',
      'city',
      'karst',
    ]);
  });

  it('keeps a granted level open below its milestone', () => {
    const j = new Journey();
    j.grant('canyon');
    expect(j.isLevelOpen('canyon')).toBe(true);
    expect(j.isLevelOpen('jerusalem')).toBe(false);
  });
});

describe('Journey / Rest cards', () => {
  it('shows each unlock once, lowest first, until revealed', () => {
    const j = new Journey();
    j.earn(unlockAt('city'));
    expect(j.unrevealed().map((u) => u.id)).toEqual(['emberTrail', 'city']);
    j.reveal();
    expect(j.unrevealed()).toEqual([]);
    j.earn(unlockAt('duskRosePlumage') - j.light);
    expect(j.unrevealed().map((u) => u.id)).toEqual(['duskRosePlumage']);
  });

  it('keeps unrevealed unlocks across a save, for flights that ended without a rest', () => {
    const j = new Journey();
    j.earn(unlockAt('emberTrail'));
    const back = new Journey(parseJourney(JSON.parse(JSON.stringify(j.toData()))));
    expect(back.unrevealed().map((u) => u.id)).toEqual(['emberTrail']);
  });

  it('never shows a card for granted levels, quiet retunes or saves from before cards', () => {
    const j = new Journey();
    j.grant('canyon');
    expect(j.unrevealed()).toEqual([]);
    Config.unlocks.crane = 5;
    expect(new Journey(parseJourney({ light: 10 })).unrevealed()).toEqual([]);
    const old = new Journey(parseJourney({ light: 400, granted: ['emberTrail', 'city'] }));
    expect(old.unrevealed()).toEqual([]);
  });

  it('remembers where the flight began', () => {
    const j = new Journey(parseJourney({ light: 200 }));
    expect(j.startLight).toBe(200);
    const before = j.fraction();
    expect(j.startFraction).toBe(before);
    j.earn(unlockAt('karst') - 200);
    expect(j.flightOpened).toBe(3); // Neon Bay, Dusk Rose, Jade River (Ember trail came before)
    expect(j.startLight).toBe(200);
    j.newFlight();
    expect(j.startLight).toBe(unlockAt('karst'));
    expect(j.flightOpened).toBe(0);
  });
});

describe('parseJourney', () => {
  it('falls back to a fresh start on garbage', () => {
    for (const raw of [null, undefined, 42, 'x', [], { light: 'lots' }, { light: Infinity }])
      expect(parseJourney(raw)).toEqual({ v: 1, light: 0, granted: [], revealed: [] });
  });

  it('clamps light and drops unknown or repeated granted ids', () => {
    expect(parseJourney({ light: -5, granted: ['city', 'city', 'moon', 7] })).toEqual({
      v: 1,
      light: 0,
      granted: ['city'],
      revealed: ['city'],
    });
    expect(parseJourney({ light: 12.7 }).light).toBe(12);
  });
});

describe('The journey track', () => {
  it('names its levels as the levels name themselves', () => {
    for (const u of UNLOCKS.filter((u) => u.kind === 'level')) {
      expect(isLevelId(u.id)).toBe(true);
      expect(LEVEL_LIST.find((l) => l.id === u.id)?.name).toBe(u.name);
    }
  });

  it('holds every level but the Highlands, in the order they are listed', () => {
    const levels = UNLOCKS.filter((u) => u.kind === 'level').map((u) => u.id);
    expect(levels).toEqual(LEVEL_LIST.slice(1).map((l) => l.id));
    const at = levels.map((id) => unlockAt(id));
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('has a threshold for every milestone, and only those', () => {
    expect(Object.keys(Config.unlocks).sort()).toEqual(UNLOCKS.map((u) => u.id).sort());
  });
});
