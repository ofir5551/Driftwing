import { Highlands } from './Highlands';
import type { LevelDef, LevelId } from './World';

/** Every level, in title-screen order. The first is the default. */
export const LEVEL_LIST: LevelDef[] = [Highlands];

export const LEVELS = Object.fromEntries(LEVEL_LIST.map((l) => [l.id, l])) as Record<
  LevelId,
  LevelDef
>;

export const isLevelId = (v: unknown): v is LevelId =>
  typeof v === 'string' && LEVEL_LIST.some((l) => l.id === v);
