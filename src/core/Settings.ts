import type { QualityLevel } from './Config';
import { isLevelId } from '../levels';
import type { LevelId } from '../levels/World';
import { isTimeOfDay, type TimeOfDay } from '../world/DayCycle';

/** Touch steering: drag a floating stick anywhere, or on-screen buttons (a D-pad, an arrow
 *  cluster under each thumb, or split: turning under one thumb, climbing under the other) with a
 *  Boost button. */
export type TouchSteer = 'drag' | 'dpad' | 'arrows' | 'split';
const isTouchSteer = (v: unknown): v is TouchSteer =>
  v === 'drag' || v === 'dpad' || v === 'arrows' || v === 'split';

export interface Settings {
  volume: number;
  muted: boolean;
  quality: QualityLevel | 'auto';
  invertY: boolean;
  touchSteer: TouchSteer;
  /** Split steering: turning on the right thumb and climbing on the left, instead of the reverse. */
  splitSwap: boolean;
  /** Last level picked on the title screen. */
  level: LevelId;
  /** Fixed look chosen on the title screen, or 'auto' for the level's own day cycle. */
  timeOfDay: TimeOfDay;
}

const KEY = 'driftwing:settings';
const BEST = 'driftwing:best';
const DEFAULTS: Settings = {
  volume: 0.8,
  muted: false,
  quality: 'auto',
  invertY: false,
  touchSteer: 'drag',
  splitSwap: false,
  level: 'highlands',
  timeOfDay: 'auto',
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
      touchSteer: isTouchSteer(s.touchSteer) ? s.touchSteer : DEFAULTS.touchSteer,
      splitSwap: s.splitSwap === true,
      level: isLevelId(s.level) ? s.level : DEFAULTS.level,
      timeOfDay: isTimeOfDay(s.timeOfDay) ? s.timeOfDay : DEFAULTS.timeOfDay,
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
