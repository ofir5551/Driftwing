/**
 * Eden's photos are kept in the repository veiled: each byte XORed with a keystream, so the
 * files are not pictures to anyone browsing the code or to image search. Not secrecy (the key
 * is here, and the game shows the photos): just not lying in plain sight. `scripts/eden-photos.mjs`
 * veils new photos with the same stream. Pure.
 */

/** The keystream's seed (the same in the script). */
export const VEIL_SEED = 0x7a1d_2312;

/** XOR `bytes` in place with the keystream (xorshift32 from the seed): veils and unveils. */
export function veil<T extends Uint8Array>(bytes: T, seed = VEIL_SEED): T {
  let s = seed >>> 0 || 1;
  for (let i = 0; i < bytes.length; i++) {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    bytes[i] ^= s & 0xff;
  }
  return bytes;
}
