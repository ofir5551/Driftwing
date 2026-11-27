import { Atoll } from './Atoll';
import { Canyon } from './Canyon';
import { City } from './City';
import { Eden } from './Eden';
import { Fjord } from './Fjord';
import { Highlands } from './Highlands';
import { Jerusalem } from './Jerusalem';
import { Karst } from './Karst';
import { Maple } from './Maple';
import { Peaks } from './Peaks';
import { Ringmoon } from './Ringmoon';
import { DEV_CHANNEL, PERSONAL_ID } from '../core/channel';
import type { LevelDef, LevelId } from './World';

/** Every level, in title-screen order. The first is the default. */
export const LEVEL_LIST: LevelDef[] = [
  Highlands,
  Eden,
  City,
  Karst,
  Fjord,
  Jerusalem,
  Canyon,
  Peaks,
  Atoll,
  Ringmoon,
  Maple,
];

export const LEVELS = Object.fromEntries(LEVEL_LIST.map((l) => [l.id, l])) as Record<
  LevelId,
  LevelDef
>;

export const isLevelId = (v: unknown): v is LevelId =>
  typeof v === 'string' && LEVEL_LIST.some((l) => l.id === v);

/** The levels a title screen lists: personal stages only on the dev channel (pure). */
export const listedLevels = (dev: boolean): LevelDef[] =>
  LEVEL_LIST.filter((l) => dev || !l.personal);

/** This build's levels on the title. */
export const LISTED_LEVELS = listedLevels(DEV_CHANNEL);

/** Whether a level may be flown in this build (a personal stage: on dev or its own build). */
export const isFlyable = (id: LevelId): boolean =>
  DEV_CHANNEL || !LEVELS[id].personal || id === PERSONAL_ID;

/** The personal stage this build flies (VITE_PERSONAL), or null in the full game. */
export const PERSONAL_LEVEL: LevelDef | null = personalLevel(PERSONAL_ID);

function personalLevel(id: string | null): LevelDef | null {
  if (id === null) return null;
  const def = isLevelId(id) ? LEVELS[id] : undefined;
  // A misspelt build fails loudly rather than shipping the full game at /<id>/.
  if (!def?.personal) throw new Error(`VITE_PERSONAL=${id} is not a personal stage`);
  return def;
}
