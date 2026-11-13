import type { QualityLevel } from './Config';
import { parseJourney, type JourneyData } from './Journey';
import { isLevelId } from '../levels';
import type { LevelId } from '../levels/World';
import { isTimeOfDay, type TimeOfDay } from '../world/DayCycle';
import { DEFAULT_PLUMAGE, isPlumageId, type PlumageId } from '../player/Plumage';
import { DEFAULT_TRAIL, isTrailId, type TrailId } from '../fx/TrailStyle';
import { DEFAULT_SPECIES, isSpeciesId, type SpeciesId } from '../player/Species';

/** Touch steering: drag a floating stick anywhere, or on-screen buttons (a D-pad, an arrow
 *  cluster under each thumb, or split: a D-pad under each thumb, each turning only its own way)
 *  with a Boost button. */
export type TouchSteer = 'drag' | 'dpad' | 'arrows' | 'split';
const isTouchSteer = (v: unknown): v is TouchSteer =>
  v === 'drag' || v === 'dpad' || v === 'arrows' || v === 'split';

/** First-flight lessons the player has learned by doing them (see Config.hints). */
export interface Taught {
  /** Gathered a wisp. */
  wisps: boolean;
  steer: boolean;
  boost: boolean;
}

export interface Settings {
  volume: number;
  muted: boolean;
  quality: QualityLevel | 'auto';
  invertY: boolean;
  touchSteer: TouchSteer;
  /** Mirror the on-screen buttons for a left thumb: Boost on the left (and the D-pad right). */
  leftHanded: boolean;
  /** Last level picked on the title screen. */
  level: LevelId;
  /** Fixed look chosen on the title screen, or 'auto' for the level's own day cycle. */
  timeOfDay: TimeOfDay;
  /** Picked in the Aviary. Flown or worn only while its milestone is open (main.ts checks). */
  species: SpeciesId;
  plumage: PlumageId;
  trail: TrailId;
  taught: Taught;
}

const KEY = 'driftwing:settings';
const BEST = 'driftwing:best';
const DEFAULTS: Settings = {
  volume: 0.8,
  muted: false,
  quality: 'auto',
  invertY: false,
  touchSteer: 'drag',
  leftHanded: false,
  level: 'highlands',
  timeOfDay: 'auto',
  species: DEFAULT_SPECIES,
  plumage: DEFAULT_PLUMAGE,
  trail: DEFAULT_TRAIL,
  taught: { wisps: false, steer: false, boost: false },
};

// localStorage can throw (private mode, disabled storage): settings then just don't persist.
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS, taught: { ...DEFAULTS.taught } };
    const s = JSON.parse(raw) as Partial<Settings>;
    return {
      volume: typeof s.volume === 'number' ? Math.min(1, Math.max(0, s.volume)) : DEFAULTS.volume,
      muted: s.muted === true,
      quality:
        s.quality === 'low' || s.quality === 'medium' || s.quality === 'high' ? s.quality : 'auto',
      invertY: s.invertY === true,
      touchSteer: isTouchSteer(s.touchSteer) ? s.touchSteer : DEFAULTS.touchSteer,
      leftHanded: s.leftHanded === true,
      level: isLevelId(s.level) ? s.level : DEFAULTS.level,
      timeOfDay: isTimeOfDay(s.timeOfDay) ? s.timeOfDay : DEFAULTS.timeOfDay,
      species: isSpeciesId(s.species) ? s.species : DEFAULTS.species,
      plumage: isPlumageId(s.plumage) ? s.plumage : DEFAULTS.plumage,
      trail: isTrailId(s.trail) ? s.trail : DEFAULTS.trail,
      taught: parseTaught(s.taught),
    };
  } catch {
    return { ...DEFAULTS, taught: { ...DEFAULTS.taught } };
  }
}

function parseTaught(raw: unknown): Taught {
  const t = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<
    Record<keyof Taught, unknown>
  >;
  return { wisps: t.wisps === true, steer: t.steer === true, boost: t.boost === true };
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

const JOURNEY = 'driftwing:journey';

export function loadJourney(): JourneyData {
  try {
    const raw = localStorage.getItem(JOURNEY);
    return parseJourney(raw ? JSON.parse(raw) : null);
  } catch {
    return parseJourney(null);
  }
}

export function saveJourney(data: JourneyData): void {
  try {
    localStorage.setItem(JOURNEY, JSON.stringify(data));
  } catch {
    /* not persisted */
  }
}
