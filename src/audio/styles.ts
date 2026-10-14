import { CITY_KEYS, DAY_KEYS, type DayKey, FJORD_KEYS, KARST_KEYS } from './scales';

/** Instrument for ambient notes, wisp notes and the lantern flourish. */
export type Voice = 'bell' | 'koto' | 'guqin' | 'glass';

/**
 * A level's musical identity. The generative engine is shared; this is what it plays and how,
 * so a level sounds like its place, not the same piece in another key. Pure data.
 */
export interface MusicStyle {
  /** Key and mode per day keyframe (dawn, day, golden, dusk, twilight). */
  keys: DayKey[];
  bpm: number;
  /** Chord roots in scale degrees, two bars each. */
  progression: number[];
  voice: Voice;
  /** Multiplier on how often ambient notes sound. */
  density: number;
  /** Chance an ambient note is ornamented with a falling grace note from a step above. */
  grace: number;
  pad: {
    wave: 'sine' | 'triangle' | 'sawtooth';
    detune: number; // cents either side
    attack: number; // s
    release: number; // s
    level: number;
  };
  /** Level of an open fifth over the drone root (a hardanger-style drone); 0 = bare root. */
  droneFifth: number;
  /** Multiplier on the reverb send. */
  reverb: number;
  /** Arpeggio faded in with flow: degrees over the chord root, notes per eighth, octave offset. */
  arp: { pattern: number[]; perStep: 1 | 2; octave: number } | null;
  /** Level of the soft lo-fi beat (kick, rim, hats); 0 = none. */
  pulse: number;
}

/** Highlands: the original pastoral score, airy saw pads and FM bells. */
export const HIGHLANDS_MUSIC: MusicStyle = {
  keys: DAY_KEYS,
  bpm: 70,
  progression: [0, 3, 1, 4, 0, 2, 3, 4],
  voice: 'bell',
  density: 1,
  grace: 0,
  pad: { wave: 'sawtooth', detune: 8, attack: 2.2, release: 3.5, level: 0.045 },
  droneFifth: 0,
  reverb: 1,
  arp: { pattern: [0, 2, 4, 6, 4, 2, 5, 3], perStep: 2, octave: 0 },
  pulse: 0,
};

/** City: night-neon lo-fi. Koto plucks over a mellow keys pad, a soft swung beat, a drier room. */
export const CITY_MUSIC: MusicStyle = {
  keys: CITY_KEYS,
  bpm: 78,
  progression: [0, 2, 3, 1, 0, 2, 4, 3],
  voice: 'koto',
  density: 0.9,
  grace: 0.08,
  pad: { wave: 'triangle', detune: 4, attack: 0.6, release: 2.5, level: 0.05 },
  droneFifth: 0,
  reverb: 0.6,
  arp: { pattern: [0, 2, 4, 2, 5, 4, 2, 1], perStep: 2, octave: 0 },
  pulse: 1,
};

/** Jade River: ink-wash stillness. A sparse guqin sliding into its notes, deep mist reverb. */
export const KARST_MUSIC: MusicStyle = {
  keys: KARST_KEYS,
  bpm: 56,
  progression: [0, 3, 0, 4, 1, 3, 0, 4],
  voice: 'guqin',
  density: 0.6,
  grace: 0.3,
  pad: { wave: 'sine', detune: 5, attack: 3.5, release: 5, level: 0.06 },
  droneFifth: 0.5,
  reverb: 1.35,
  arp: null,
  pulse: 0,
};

/** Aurora Fjords: cold and vast. Glassy bells, an open-fifth drone, a slow music-box arpeggio. */
export const FJORD_MUSIC: MusicStyle = {
  keys: FJORD_KEYS,
  bpm: 62,
  progression: [0, 4, 3, 0, 2, 4, 3, 1],
  voice: 'glass',
  density: 0.65,
  grace: 0,
  pad: { wave: 'triangle', detune: 10, attack: 3, release: 5, level: 0.055 },
  droneFifth: 0.8,
  reverb: 1.5,
  arp: { pattern: [0, 2, 4, 7, 4, 2], perStep: 1, octave: 12 },
  pulse: 0,
};
