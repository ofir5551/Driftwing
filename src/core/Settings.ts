import { DEV_CHANNEL, PERSONAL_CHANNEL } from './channel';
import type { QualityLevel } from './Config';
import { parseJourney, type JourneyData } from './Journey';
import { isLevelId } from '../levels';
import type { LevelId } from '../levels/World';
import { parseSeenNotes } from '../world/LanternNotes';
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

// The dev channel keeps its own settings and bests (same site as the players' build).
const PREFIX = DEV_CHANNEL ? 'driftwing-dev:' : 'driftwing:';
const KEY = `${PREFIX}settings`;

// A personal channel (e.g. a wedding invitation) keeps nothing: every visit starts fresh, and the
// players' save on the same site is never read or touched. Reads find nothing, writes vanish.
function read(key: string): string | null {
  return PERSONAL_CHANNEL ? null : localStorage.getItem(key);
}
function write(key: string, value: string): void {
  if (!PERSONAL_CHANNEL) localStorage.setItem(key, value);
}
const BEST = `${PREFIX}best`;
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
    const raw = read(KEY);
    if (!raw) return { ...DEFAULTS, taught: { ...DEFAULTS.taught } };
    const s = JSON.parse(raw) as Partial<Settings>;
    return {
      // Loudness is the device's: Settings has only Sound on/off, so an old quieter slider pick
      // (which could no longer be undone) is not kept.
      volume: DEFAULTS.volume,
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
    write(KEY, JSON.stringify(s));
  } catch {
    /* not persisted */
  }
}

// The first level keeps the original key so existing best scores carry over.
const bestKey = (level: LevelId) => (level === 'highlands' ? BEST : `${BEST}:${level}`);

export function loadBest(level: LevelId): number {
  try {
    return Number(read(bestKey(level))) || 0;
  } catch {
    return 0;
  }
}

export function saveBest(level: LevelId, score: number): void {
  try {
    write(bestKey(level), String(score));
  } catch {
    /* not persisted */
  }
}

const NOTES = `${PREFIX}lantern-notes`;

/** The lantern notes shown lately (texts, oldest first), so a note waits its turn across flights. */
export function loadSeenNotes(): string[] {
  try {
    const raw = read(NOTES);
    return parseSeenNotes(raw ? JSON.parse(raw) : null);
  } catch {
    return [];
  }
}

export function saveSeenNotes(seen: readonly string[]): void {
  try {
    write(NOTES, JSON.stringify(seen));
  } catch {
    /* not persisted */
  }
}

const JOURNEY = `${PREFIX}journey`;

export function loadJourney(): JourneyData {
  try {
    const raw = read(JOURNEY);
    return parseJourney(raw ? JSON.parse(raw) : null);
  } catch {
    return parseJourney(null);
  }
}

export function saveJourney(data: JourneyData): void {
  try {
    write(JOURNEY, JSON.stringify(data));
  } catch {
    /* not persisted */
  }
}

const FS_PROMPT_OFF = `${PREFIX}fullscreen-prompt-off`;

/** The player chose "Don't show again" on the launch fullscreen card. */
export function loadFsPromptOff(): boolean {
  try {
    return read(FS_PROMPT_OFF) === '1';
  } catch {
    return false;
  }
}

export function saveFsPromptOff(): void {
  try {
    write(FS_PROMPT_OFF, '1');
  } catch {
    /* not persisted: the card comes back next launch */
  }
}

const SEEN_VERSION = `${PREFIX}seen-version`;

/** The last game version whose What's new the player opened (null: never saved), and whether
 *  they played before versions were saved (anything else of theirs is stored). */
export function loadSeenVersion(): { saved: string | null; playedBefore: boolean } {
  try {
    return {
      saved: read(SEEN_VERSION),
      playedBefore: read(KEY) !== null || read(JOURNEY) !== null,
    };
  } catch {
    return { saved: null, playedBefore: false };
  }
}

export function saveSeenVersion(version: string): void {
  try {
    write(SEEN_VERSION, version);
  } catch {
    /* not persisted */
  }
}
