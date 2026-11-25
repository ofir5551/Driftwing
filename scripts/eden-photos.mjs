// Veil Eden's photos for the repository: node scripts/eden-photos.mjs <tal.jpg> <hadar.jpg> <couple.jpg>
// Writes src/world/eden/photos/p0.bin, p1.bin, p2.bin (each byte XORed with the keystream in
// src/world/eden/veil.ts, which the game uses to show them). Portraits 3:4, the couple 16:9;
// strip metadata and keep each under ~200 kB first (e.g. re-save at 1280 px, quality 82).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const SEED = 0x7a1d2312; // VEIL_SEED in src/world/eden/veil.ts

function veil(bytes) {
  let s = SEED >>> 0 || 1;
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

const files = process.argv.slice(2);
if (files.length !== 3) {
  console.log('usage: node scripts/eden-photos.mjs <tal.jpg> <hadar.jpg> <couple.jpg>');
  process.exit(1);
}
mkdirSync('src/world/eden/photos', { recursive: true });
files.forEach((f, i) => {
  const out = `src/world/eden/photos/p${i}.bin`;
  writeFileSync(out, veil(new Uint8Array(readFileSync(f))));
  console.log('veiled', f, '->', out);
});
