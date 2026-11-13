import { describe, expect, it } from 'vitest';
import { Config } from '../src/core/Config';
import { Journey, parseJourney } from '../src/core/Journey';
import { LEVEL_LIST } from '../src/levels';
import {
  DiscoveryTracker,
  LEVEL_FINDS,
  isFindId,
  type DiscoveryDef,
} from '../src/world/Discoveries';
import { AtollLayout } from '../src/world/atoll/AtollLayout';
import { atollFinds } from '../src/world/atoll/finds';
import { CanyonLayout } from '../src/world/canyon/CanyonLayout';
import { canyonFinds } from '../src/world/canyon/finds';
import { CityLayout } from '../src/world/city/CityLayout';
import { cityFinds } from '../src/world/city/finds';
import { FjordLayout } from '../src/world/fjord/FjordLayout';
import { fjordFinds } from '../src/world/fjord/finds';
import { highlandsFinds } from '../src/world/highlands/finds';
import { JerusalemLayout } from '../src/world/jerusalem/JerusalemLayout';
import { jerusalemFinds } from '../src/world/jerusalem/finds';
import { KarstLayout, type Pillar } from '../src/world/karst/KarstLayout';
import { karstFinds } from '../src/world/karst/finds';
import { PeaksLayout } from '../src/world/peaks/PeaksLayout';
import { peaksFinds } from '../src/world/peaks/finds';
import { RingmoonLayout } from '../src/world/ringmoon/RingmoonLayout';
import { ringmoonFinds } from '../src/world/ringmoon/finds';
import { flyBot } from './helpers';

const SEED = Config.world.seed;
const STEP = Config.discoveries.every;

/** A tracker for one level's defs; `look` takes one look (a full interval) at a point. */
function tracker(defs: readonly DiscoveryDef[]) {
  const t = new DiscoveryTracker();
  t.setLevel(defs);
  const look = (x: number, y: number, z: number, stars = 0) => t.step(STEP, x, y, z, stars);
  return { t, look };
}

/** Flies a circle of radius r at height y round (cx, cz), in 36 looks; returns the finds made. */
function circle(
  look: (x: number, y: number, z: number) => DiscoveryDef | null,
  cx: number,
  cz: number,
  r: number,
  y: number,
  turns = 1.1,
): string[] {
  const out: string[] = [];
  const n = Math.ceil(36 * turns);
  for (let k = 0; k <= n; k++) {
    const a = (k / 36) * Math.PI * 2;
    const f = look(cx + Math.sin(a) * r, y, cz + Math.cos(a) * r);
    if (f) out.push(f.id);
  }
  return out;
}

const at = (id: string, test: DiscoveryDef['at']): DiscoveryDef => ({ id, name: id, at: test });

describe('DiscoveryTracker', () => {
  it('only looks every interval, and finds each place once', () => {
    const { t } = tracker([at('a', () => true)]);
    expect(t.step(STEP / 2, 0, 0, 0, 0)).toBeNull();
    expect(t.step(STEP / 2, 0, 0, 0, 0)?.id).toBe('a');
    expect(t.step(STEP, 0, 0, 0, 0)).toBeNull();
  });

  it('needs the dwell held unbroken', () => {
    const { look } = tracker([{ ...at('a', (x) => x > 0), dwell: 0.35 }]);
    expect([look(1, 0, 0), look(1, 0, 0), look(-1, 0, 0), look(1, 0, 0), look(1, 0, 0)]).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(look(1, 0, 0)).toBeNull();
    expect(look(1, 0, 0)?.id).toBe('a');
  });

  it('keeps night finds for the night', () => {
    const { look } = tracker([{ ...at('a', () => true), night: true }]);
    expect(look(0, 0, 0, 0.2)).toBeNull();
    expect(look(0, 0, 0, Config.discoveries.night)?.id).toBe('a');
  });

  it('skips what the journey already holds', () => {
    const { t, look } = tracker([at('a', () => true)]);
    t.known = (id) => id === 'a';
    expect(look(0, 0, 0)).toBeNull();
  });

  it('counts a full turn round the pivot, either way, and not a turn undone', () => {
    const orbit: DiscoveryDef = {
      id: 'o',
      name: 'o',
      around: (x, _y, z, p) => {
        p.x = 0;
        p.z = 0;
        return Math.hypot(x, z) < 50;
      },
    };
    expect(circle(tracker([orbit]).look, 0, 0, 30, 0, 0.9)).toEqual([]);
    expect(circle(tracker([orbit]).look, 0, 0, 30, 0)).toEqual(['o']);
    expect(circle(tracker([orbit]).look, 0, 0, -30, 0)).toEqual(['o']); // the other way round
    // Half a turn out and half back again.
    const { look } = tracker([orbit]);
    for (let k = 0; k <= 18; k++)
      look(Math.sin((k / 36) * 6.28) * 30, 0, Math.cos((k / 36) * 6.28) * 30);
    const back: (DiscoveryDef | null)[] = [];
    for (let k = 18; k >= -18; k--)
      back.push(look(Math.sin((k / 36) * 6.28) * 30, 0, Math.cos((k / 36) * 6.28) * 30));
    expect(back.every((f) => f === null)).toBe(true);
    // Leaving the band starts the turn again.
    const t2 = tracker([orbit]);
    for (let k = 0; k <= 30; k++)
      t2.look(Math.sin((k / 36) * 6.28) * 30, 0, Math.cos((k / 36) * 6.28) * 30);
    t2.look(500, 0, 0);
    expect(circle(t2.look, 0, 0, 30, 0, 0.5)).toEqual([]);
  });
});

describe('Discoveries', () => {
  it('gives every level three finds with unique ids', () => {
    const ids = LEVEL_LIST.flatMap((l) => LEVEL_FINDS[l.id].map((f) => f.id));
    expect(ids.length).toBe(LEVEL_LIST.length * 3);
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of LEVEL_LIST)
      expect(LEVEL_FINDS[l.id].every((f) => f.id.startsWith(`${l.id}.`))).toBe(true);
  });

  it('are saved in the journey, once each, and unknown ids are dropped', () => {
    const j = new Journey();
    expect(j.discover('fjord.berg')).toBe(true);
    expect(j.discover('fjord.berg')).toBe(false);
    expect(j.discover('nowhere.at-all')).toBe(false);
    expect(j.flightFinds).toEqual(['fjord.berg']);
    expect(j.foundIn('fjord')).toBe(1);
    const back = new Journey(
      parseJourney({ ...JSON.parse(JSON.stringify(j.toData())), found: ['fjord.berg', 'x.y', 3] }),
    );
    expect(back.hasFound('fjord.berg')).toBe(true);
    expect(back.toData().found).toEqual(['fjord.berg']);
    expect(back.flightFinds).toEqual([]);
    expect(parseJourney({ light: 3 }).found).toEqual([]);
    expect(isFindId('city.shore')).toBe(true);
  });

  // Following the wisps must never stumble on a find: they are for the curious.
  it.each(LEVEL_LIST.flatMap((l) => [[l.id, 'day', l] as const, [l.id, 'night', l] as const]))(
    'are not on the ribbons the bot follows in %s (%s)',
    (_id, when, level) => {
      const { world, spawn } = level.create(SEED);
      const { look } = tracker(world.discoveries);
      const stars = when === 'night' ? 1 : 0;
      const made: string[] = [];
      flyBot(
        world,
        spawn,
        SEED,
        60,
        () => false,
        undefined,
        (x, y, z) => {
          const f = look(x, y, z, stars);
          if (f) made.push(f.id);
        },
      );
      expect(made).toEqual([]);
    },
    60_000,
  );
});

/** Whether a single look at (x, y, z) makes the find `key` among `defs`. */
function makes(
  defs: readonly DiscoveryDef[],
  key: string,
  x: number,
  y: number,
  z: number,
  stars = 0,
): boolean {
  const { look } = tracker(defs.filter((d) => d.id.endsWith(`.${key}`)));
  return look(x, y, z, stars) !== null;
}

describe('Each level’s finds can be made', () => {
  it('Highlands: above the clouds; atop and beneath an isle', () => {
    const isle = { x: 100, y: 200, z: 0, r: 40, depth: 60, mesh: null };
    const defs = highlandsFinds(() => [isle]);
    expect(makes(defs, 'clouds', 0, 300, 0)).toBe(true);
    expect(makes(defs, 'clouds', 0, 200, 0)).toBe(false);
    expect(makes(defs, 'isle', 110, 205, 0)).toBe(true);
    expect(makes(defs, 'under', 100, 120, 0)).toBe(true);
    expect(makes(defs, 'under', 100, 300, 0)).toBe(false);
  });

  it('Neon Bay: across the bay', () => {
    const L = new CityLayout(SEED);
    expect(makes(cityFinds(L), 'shore', 0, 20, L.shoreFar(0) + 60)).toBe(true);
    expect(makes(cityFinds(L), 'shore', L.spawn.x, L.spawn.y, L.spawn.z)).toBe(false);
  });

  it('Jade River: on a pavilion summit and round a tall pillar', () => {
    const L = new KarstLayout(SEED);
    const defs = karstFinds(L);
    let pav: Pillar | null = null;
    let tall: Pillar | null = null;
    for (let j = -12; j <= 12 && !(pav && tall); j++)
      for (let i = -12; i <= 12; i++)
        for (const p of L.cell(i, j)) {
          if (p.pavilion && !pav) pav = p;
          if (p.h >= 80 && !tall) tall = p;
        }
    expect(pav).not.toBeNull();
    expect(tall).not.toBeNull();
    expect(makes(defs, 'pavilion', pav!.x + pav!.lx, pav!.top + 5, pav!.z + pav!.lz)).toBe(true);
    const p = tall!;
    const { look } = tracker(defs.filter((d) => d.id === 'karst.pillar'));
    expect(
      circle(look, p.x + p.lx * 0.5, p.z + p.lz * 0.5, p.reach + 15, p.y0 + p.h * 0.5),
    ).toEqual(['karst.pillar']);
  });

  it('Aurora Fjords: round the lighthouse, and the ceiling only at night', () => {
    const L = new FjordLayout(SEED);
    const defs = fjordFinds(L);
    const h = L.lighthouse;
    const { look } = tracker(defs);
    expect(circle(look, h.x, h.z, 40, h.y0 + 20)).toEqual(['fjord.lighthouse']);
    const y = Config.flight.maxAltitude - 10;
    expect(makes(defs, 'aurora', 0, y, 0, 0)).toBe(false);
    expect(makes(defs, 'aurora', 0, y, 0, 1)).toBe(true);
  });

  it('City of Gold: over the dome, not beside it', () => {
    const L = new JerusalemLayout(SEED);
    const d = L.dome;
    expect(makes(jerusalemFinds(L), 'dome', d.x, d.top + 6, d.z)).toBe(true);
    expect(makes(jerusalemFinds(L), 'dome', d.x + 60, d.top + 6, d.z)).toBe(false);
  });

  it('Red Canyons: over the Great Arch', () => {
    const L = new CanyonLayout(SEED);
    const G = L.great;
    const top = L.archTop(G, G.x, G.z);
    expect(Number.isFinite(top)).toBe(true);
    expect(makes(canyonFinds(L), 'great', G.x, top + 5, G.z)).toBe(true);
    expect(makes(canyonFinds(L), 'great', G.x, G.y0 + G.h * 0.4, G.z)).toBe(false); // threading it
  });

  it('Sea of Clouds: at the monastery', () => {
    const L = new PeaksLayout(SEED);
    const m = L.gate[0];
    expect(makes(peaksFinds(L), 'monastery', m.x + m.lx, m.top + 5, m.z + m.lz)).toBe(true);
    expect(makes(peaksFinds(L), 'stars', 0, Config.flight.maxAltitude - 10, 0, 1)).toBe(true);
  });

  it("Coral Atolls: at the fang's summit, and round it by moonlight", () => {
    const L = new AtollLayout(SEED);
    const I = L.atoll(0, 0)!.island!;
    const defs = atollFinds(L);
    expect(makes(defs, 'fang', I.tx, I.th + 5, I.tz)).toBe(true);
    const moon = defs.filter((d) => d.id === 'atoll.moonlit');
    const day = tracker(moon);
    expect(circle((x, y, z) => day.look(x, y, z, 0), I.tx, I.tz, I.tr + 60, I.th / 2)).toEqual([]);
    const night = tracker(moon);
    expect(circle((x, y, z) => night.look(x, y, z, 1), I.tx, I.tz, I.tr + 60, I.th / 2)).toEqual([
      'atoll.moonlit',
    ]);
  });

  it('Jade River: the paddies, at night', () => {
    const L = new KarstLayout(SEED);
    let spot: [number, number] | null = null;
    for (let r = 100; r < 4000 && !spot; r += 25)
      for (let a = 0; a < 6.28 && !spot; a += 0.1) {
        const x = Math.sin(a) * r;
        const z = Math.cos(a) * r;
        if (L.river(x, z) > 60 && L.paddy(x, z) > 0.7) spot = [x, z];
      }
    expect(spot).not.toBeNull();
    const [x, z] = spot!;
    const y = L.height(x, z) + 10;
    expect(makes(karstFinds(L), 'paddies', x, y, z, 0)).toBe(false);
    expect(makes(karstFinds(L), 'paddies', x, y, z, 1)).toBe(true);
  });

  it('Ringmoon Shallows: round the ship and along its back', () => {
    const L = new RingmoonLayout(SEED);
    const S = L.ship;
    const defs = ringmoonFinds(L);
    expect(makes(defs, 'back', S.x, L.shipTop(S.x, S.z) + 4, S.z)).toBe(true);
    const { look } = tracker(defs.filter((d) => d.id === 'ringmoon.ship'));
    expect(circle(look, S.x, S.z, 160, 40)).toEqual(['ringmoon.ship']);
  });
});
