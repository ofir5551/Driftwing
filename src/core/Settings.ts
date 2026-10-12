import type { QualityLevel } from './Config';

export interface Settings {
  volume: number;
  muted: boolean;
  quality: QualityLevel | 'auto';
  invertY: boolean;
  /** Touch: put the flap button at the bottom left instead of the bottom right. */
  leftHanded: boolean;
}

const KEY = 'driftwing:settings';
const BEST = 'driftwing:best';
const DEFAULTS: Settings = {
  volume: 0.8,
  muted: false,
  quality: 'auto',
  invertY: false,
  leftHanded: false,
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

export function loadBest(): number {
  try {
    return Number(localStorage.getItem(BEST)) || 0;
  } catch {
    return 0;
  }
}

export function saveBest(score: number): void {
  try {
    localStorage.setItem(BEST, String(score));
  } catch {
    /* not persisted */
  }
}
