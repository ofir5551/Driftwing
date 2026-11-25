import p0 from './photos/p0.bin?url';
import p1 from './photos/p1.bin?url';
import p2 from './photos/p2.bin?url';
import { veil } from './veil';

/**
 * The pictures Eden shows: one per stop, by destination id. The files in `photos/` are the
 * photos veiled (`veil.ts`), so the repository holds no plain pictures; make new ones with
 * `node scripts/eden-photos.mjs` (portraits 3:4; the venue's is the wedding invitation, 0.6:1).
 */
export interface EdenPhoto {
  /** The destination it waits at. */
  readonly id: 'eden:tal' | 'eden:hadar' | 'eden:venue';
  /** The veiled file. */
  readonly file: string;
  /** Under the picture on its easel, and on the card shown on arrival. */
  readonly caption: string;
  /** A second line on the card. */
  readonly line: string;
  /** Under the caption, on the plaque and the card (the wedding's date, for the couple). */
  readonly date?: string;
  /**
   * A tall picture that speaks for itself (the invitation, names and date and all): its card
   * shows it taller and without the caption.
   */
  readonly tall?: boolean;
}

/** Tal and Hadar's wedding day. */
export const WEDDING_DATE = '23.12.2026';

export const EDEN_PHOTOS: readonly [EdenPhoto, EdenPhoto, EdenPhoto] = [
  { id: 'eden:tal', file: p0, caption: 'Tal', line: 'joins your flock' },
  { id: 'eden:hadar', file: p1, caption: 'Hadar', line: 'joins the two of you' },
  {
    id: 'eden:venue',
    file: p2,
    caption: 'Tal & Hadar',
    line: 'Mazal tov!',
    date: WEDDING_DATE,
    tall: true,
  },
];

export const edenPhoto = (id: string): EdenPhoto | undefined =>
  EDEN_PHOTOS.find((p) => p.id === id);

const unveiled = new Map<string, Promise<string>>();

/** The photo as an image URL, unveiled once (browser only: a blob URL kept for the session). */
export function photoUrl(p: EdenPhoto): Promise<string> {
  let u = unveiled.get(p.id);
  if (!u) {
    u = fetch(p.file)
      .then((r) => r.arrayBuffer())
      .then((b) =>
        URL.createObjectURL(new Blob([veil(new Uint8Array(b))], { type: 'image/jpeg' })),
      );
    unveiled.set(p.id, u);
  }
  return u;
}
