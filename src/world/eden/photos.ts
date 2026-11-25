import talUrl from './photos/tal.jpg';
import hadarUrl from './photos/hadar.jpg';
import coupleUrl from './photos/couple.jpg';

/**
 * The pictures Eden shows: one per stop, by destination id. Replace the files in `photos/`
 * to change them (portraits 3:4, the couple 16:9); nothing else needs to change.
 */
export interface EdenPhoto {
  /** The destination it waits at. */
  readonly id: 'eden:tal' | 'eden:hadar' | 'eden:venue';
  readonly url: string;
  /** Under the picture on its easel, and on the card shown on arrival. */
  readonly caption: string;
  /** A second line on the card. */
  readonly line: string;
}

export const EDEN_PHOTOS: readonly [EdenPhoto, EdenPhoto, EdenPhoto] = [
  { id: 'eden:tal', url: talUrl, caption: 'Tal', line: 'joins your flock' },
  { id: 'eden:hadar', url: hadarUrl, caption: 'Hadar', line: 'joins the two of you' },
  { id: 'eden:venue', url: coupleUrl, caption: 'Tal & Hadar', line: 'Mazal tov!' },
];

export const edenPhoto = (id: string): EdenPhoto | undefined =>
  EDEN_PHOTOS.find((p) => p.id === id);
