import type { UnlockId } from '../core/Journey';

/**
 * A plumage: the bird's colour roles (sRGB hex). The bird is built once and repainted from one
 * of these, so every palette reads through the same pattern: a pale body and underwing, a
 * darker mantle and cap, a dusky trailing edge, primaries that grade base -> mid -> tip.
 * Pure data: the menu reads it for swatches, `Bird` for vertex colours.
 */
export interface PlumageColors {
  belly: string;
  /** Warm flush on the breast, over the belly colour. */
  breast: string;
  back: string;
  cap: string;
  wingLead: string;
  wingTrail: string;
  covert: string;
  /** Trailing edge of the secondaries. */
  dusky: string;
  underwing: string;
  bill: string;
  billTip: string;
  primaryBase: string;
  primaryMid: string;
  primaryTip: string;
  tailBase: string;
  tailTip: string;
  feet: string;
}

export type PlumageId = 'sea' | 'duskRose' | 'frost' | 'gilded';

export interface PlumageDef {
  readonly id: PlumageId;
  readonly name: string;
  /** The journey milestone that opens it; null for the starting plumage. */
  readonly unlock: UnlockId | null;
  readonly colors: PlumageColors;
}

/**
 * Each is checked against every level at dawn, midday and night: the mantle and cap stay dark
 * enough to read against a bright sky, the belly pale enough to read against water and land.
 */
export const PLUMAGES: readonly PlumageDef[] = [
  {
    // The original bird: a pale tern, warm-grey mantle, dark cap, warm-to-dusky primaries.
    id: 'sea',
    name: 'Sea',
    unlock: null,
    colors: {
      belly: '#f7f1e8',
      breast: '#f6e6d6',
      back: '#aea6ae',
      cap: '#4b4253',
      wingLead: '#f3ebe1',
      wingTrail: '#ada4ab',
      covert: '#c6bec2',
      dusky: '#776a73',
      underwing: '#fbf6ef',
      bill: '#ef8a4a',
      billTip: '#3f2f33',
      primaryBase: '#d9c9b9',
      primaryMid: '#e7a37c',
      primaryTip: '#4e4458',
      tailBase: '#e9ddcf',
      tailTip: '#bf8f7b',
      feet: '#e2804f',
    },
  },
  {
    // Evening light: a rose breast, mauve mantle, plum cap and coral-tipped wings.
    id: 'duskRose',
    name: 'Dusk Rose',
    unlock: 'duskRosePlumage',
    colors: {
      belly: '#f9ece9',
      breast: '#f4c9c2',
      back: '#b98fa0',
      cap: '#5a3a52',
      wingLead: '#f6e2e0',
      wingTrail: '#b48c9c',
      covert: '#d6aeb8',
      dusky: '#7a5068',
      underwing: '#fcf1ef',
      bill: '#e9887a',
      billTip: '#4a2c3a',
      primaryBase: '#e2bfc0',
      primaryMid: '#ee9a8e',
      primaryTip: '#5b3a5e',
      tailBase: '#f0d6d4',
      tailTip: '#c47f8e',
      feet: '#e07a6a',
    },
  },
  {
    // Winter: ice-white below, slate-blue above, a cold blue blush through the primaries.
    id: 'frost',
    name: 'Frost',
    unlock: 'frostPlumage',
    colors: {
      belly: '#f4f8fb',
      breast: '#e1ecf5',
      back: '#9fb4c8',
      cap: '#3f5170',
      wingLead: '#eef5fa',
      wingTrail: '#9db1c4',
      covert: '#c4d4e2',
      dusky: '#6b7f99',
      underwing: '#f8fbfd',
      bill: '#5d6f8a',
      billTip: '#2c3447',
      primaryBase: '#d3e1ec',
      primaryMid: '#9cc4e4',
      primaryTip: '#3e4e6e',
      tailBase: '#e2ecf4',
      tailTip: '#8eaacb',
      feet: '#9fb1c6',
    },
  },
  {
    // Late sun: cream and honey, a bronze mantle and cap, gold-dipped primaries.
    id: 'gilded',
    name: 'Gilded',
    unlock: 'gildedPlumage',
    colors: {
      belly: '#faf1dc',
      breast: '#f5dcae',
      back: '#c9a46a',
      cap: '#6a4a2a',
      wingLead: '#f8ecd2',
      wingTrail: '#c39f68',
      covert: '#e0c48e',
      dusky: '#8c6638',
      underwing: '#fcf5e4',
      bill: '#e8b04a',
      billTip: '#4a3218',
      primaryBase: '#ecd3a0',
      primaryMid: '#f0b452',
      primaryTip: '#6e4a26',
      tailBase: '#f2e0b8',
      tailTip: '#c99245',
      feet: '#e3a24a',
    },
  },
];

export const DEFAULT_PLUMAGE: PlumageId = 'sea';

export const isPlumageId = (v: unknown): v is PlumageId => PLUMAGES.some((p) => p.id === v);

export const plumageDef = (id: PlumageId): PlumageDef =>
  PLUMAGES.find((p) => p.id === id) ?? PLUMAGES[0];
