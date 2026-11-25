import p0 from './photos/p0.bin?url';
import p1 from './photos/p1.bin?url';
import p2 from './photos/p2.bin?url';
import { veil } from './veil';

/**
 * The pictures Eden shows: one per stop, by destination id. The files in `photos/` are the
 * photos veiled (`veil.ts`), so the repository holds no plain pictures; make new ones with
 * `node scripts/eden-photos.mjs` (portraits 3:4, the couple 16:9).
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
}

export const EDEN_PHOTOS: readonly [EdenPhoto, EdenPhoto, EdenPhoto] = [
  { id: 'eden:tal', file: p0, caption: 'Tal', line: 'joins your flock' },
  { id: 'eden:hadar', file: p1, caption: 'Hadar', line: 'joins the two of you' },
  { id: 'eden:venue', file: p2, caption: 'Tal & Hadar', line: 'Mazal tov!' },
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
