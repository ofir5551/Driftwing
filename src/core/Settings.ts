import type { QualityLevel } from './Config';
import { isLevelId } from '../levels';
import type { LevelId } from '../levels/World';

export interface Settings {
  volume: number;
  muted: boolean;
  quality: QualityLevel | 'auto';
  invertY: boolean;
  /** Touch: put the flap button at the bottom left instead of the bottom right. */
  leftHanded: boolean;
  /** Last level picked on the title screen. */
  level: LevelId;
}

const KEY = 'driftwing:settings';
const BEST = 'driftwing:best';
const DEFAULTS: Settings = {
  volume: 0.8,
  muted: false,
  quality: 'auto',
  invertY: false,
  leftHanded: false,
  level: 'highlands',
};

// localStorage can throw (private mode, disabled storage): settings then just don't persist.
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const s = JSON.parse(raw) as Partial<Settings>;
    return {
      volume: typeof s.volume === 'number' ? Math.min(1, Math.max(0, s.volume)) : DEFAULTS.volume,
      muted: s.muted === true,
      quality:
        s.quality === 'low' || s.quality === 'medium' || s.quality === 'high' ? s.quality : 'auto',
      invertY: s.invertY === true,
      leftHanded: s.leftHanded === true,
      level: isLevelId(s.level) ? s.level : DEFAULTS.level,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* not persisted */
  }
}

// The first level keeps the original key so existing best scores carry over.
const bestKey = (level: LevelId) => (level === 'highlands' ? BEST : `${BEST}:${level}`);

export function loadBest(level: LevelId): number {
  try {
    return Number(localStorage.getItem(bestKey(level))) || 0;
  } catch {
    return 0;
  }
}

export function saveBest(level: LevelId, score: number): void {
  try {
    localStorage.setItem(bestKey(level), String(score));
  } catch {
    /* not persisted */
  }
}
