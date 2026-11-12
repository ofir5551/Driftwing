import {
  ATOLL_KEYS,
  CANYON_KEYS,
  CITY_KEYS,
  DAY_KEYS,
  type DayKey,
  FJORD_KEYS,
  JERUSALEM_KEYS,
  KARST_KEYS,
  PEAKS_KEYS,
} from './scales';

/** Instrument for ambient notes, wisp notes and the lantern flourish. */
export type Voice = 'bell' | 'koto' | 'guqin' | 'glass' | 'oud' | 'guitar' | 'flute' | 'marimba';

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
  /** Level of the soft beat; 0 = none. */
  pulse: number;
  /** The beat's pattern: a swung lo-fi kit (default), maqsum on a frame drum, or an island
   *  lilt of shaker and log drum. */
  beat?: 'lofi' | 'maqsum' | 'island';
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

/**
 * City of Gold: warm stone and old songs. A plucked oud with ornaments over a soft sine pad
 * and an open-fifth drone, qanun-like ripples with flow, and maqsum on a frame drum.
 */
export const JERUSALEM_MUSIC: MusicStyle = {
  keys: JERUSALEM_KEYS,
  bpm: 66,
  progression: [0, 1, 0, 3, 0, 1, 3, 0],
  voice: 'oud',
  density: 0.8,
  grace: 0.25,
  pad: { wave: 'sine', detune: 7, attack: 2.6, release: 4.5, level: 0.05 },
  droneFifth: 0.6,
  reverb: 1.15,
  arp: { pattern: [0, 1, 2, 1, 0, 2, 3, 2], perStep: 2, octave: 12 },
  pulse: 0.7,
  beat: 'maqsum',
};

/**
 * Red Canyons: wide open and on the move. A twangy desert guitar (with a shimmer of vibrato on
 * long notes) over open fifths, a galloping arpeggio with flow, a long canyon echo, and the
 * quickest tempo of any level.
 */
export const CANYON_MUSIC: MusicStyle = {
  keys: CANYON_KEYS,
  bpm: 84,
  progression: [0, 3, 4, 0, 0, 3, 1, 4],
  voice: 'guitar',
  density: 0.75,
  grace: 0.12,
  pad: { wave: 'triangle', detune: 6, attack: 2, release: 4, level: 0.042 },
  droneFifth: 0.75,
  reverb: 1.3,
  arp: { pattern: [0, 4, 2, 4, 0, 4, 2, 4], perStep: 2, octave: 0 },
  pulse: 0,
};

/**
 * Sea of Clouds: weightless and high. A breathy bamboo flute that bends up into its notes and
 * blooms a slow vibrato, over a wide, high sine pad and an open-fifth drone, a slow glinting
 * arpeggio an octave up with flow, and the largest room of any level, as if the sound carried
 * across the cloud sea and came back off the far peaks.
 */
export const PEAKS_MUSIC: MusicStyle = {
  keys: PEAKS_KEYS,
  bpm: 60,
  progression: [0, 3, 1, 4, 0, 2, 3, 0],
  voice: 'flute',
  density: 0.55,
  grace: 0.22,
  pad: { wave: 'sine', detune: 9, attack: 4, release: 6, level: 0.06 },
  droneFifth: 0.7,
  reverb: 1.6,
  arp: { pattern: [0, 4, 2, 7, 4, 2], perStep: 1, octave: 12 },
  pulse: 0,
};

/**
 * Coral Atolls: sunny and playful. A wooden marimba (rolled on its long notes) bouncing over a
 * light triangle pad, a skipping arpeggio an octave up with flow, an easy island lilt of shaker
 * and log drum, the quickest tempo of any level and an open-air room, short and bright.
 */
export const ATOLL_MUSIC: MusicStyle = {
  keys: ATOLL_KEYS,
  bpm: 88,
  progression: [0, 3, 4, 0, 1, 3, 4, 0],
  voice: 'marimba',
  density: 0.85,
  grace: 0.1,
  pad: { wave: 'triangle', detune: 5, attack: 1.6, release: 3, level: 0.038 },
  droneFifth: 0.3,
  reverb: 0.75,
  arp: { pattern: [0, 2, 4, 2, 5, 4, 2, 4], perStep: 2, octave: 12 },
  pulse: 0.6,
  beat: 'island',
};
