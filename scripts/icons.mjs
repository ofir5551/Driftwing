// Paints the app icon (a tern gliding over a dusk sun, wisps trailing) and writes the files the
// web app manifest and index.html point at into public/icons/. The SVG is the source; the PNGs
// are what Android, iOS and desktop installs need. Re-run after changing the art:
//   node scripts/icons.mjs
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(out, { recursive: true });

/** `rounded`: a soft square for browsers and desktops that show the icon as is. Otherwise full
 *  bleed, for maskable (Android crops it to its own shape) and iOS (which rounds it itself). The
 *  bird and wisps sit inside the central 80% circle, the maskable safe zone, so both crops work. */
function icon(rounded) {
  const clip = rounded
    ? '<clipPath id="c"><rect width="512" height="512" rx="112"/></clipPath>'
    : '';
  const g = rounded ? '<g clip-path="url(#c)">' : '<g>';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    ${clip}
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#6f6596"/>
      <stop offset="0.45" stop-color="#c98ea0"/>
      <stop offset="0.75" stop-color="#f0a37a"/>
      <stop offset="1" stop-color="#f3c9a8"/>
    </linearGradient>
    <radialGradient id="sun" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#fffbe6"/>
      <stop offset="0.35" stop-color="#fff3c4"/>
      <stop offset="1" stop-color="#fff3c4" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="wisp" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.3" stop-color="#fff3c4"/>
      <stop offset="1" stop-color="#ffd27a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  ${g}
    <rect width="512" height="512" fill="url(#sky)"/>
    <circle cx="256" cy="330" r="180" fill="url(#sun)"/>
    <circle cx="256" cy="330" r="44" fill="#fff6d6"/>
    <path d="M0 392 C70 352 128 372 188 356 C250 340 300 372 360 360 C420 348 470 362 512 344 L512 512 L0 512 Z" fill="#a9708a" opacity="0.55"/>
    <path d="M0 430 C80 404 150 424 230 410 C310 396 380 424 512 400 L512 512 L0 512 Z" fill="#7d5a7e" opacity="0.7"/>
    <path d="M0 470 C110 452 200 466 290 456 C380 446 450 462 512 452 L512 512 L0 512 Z" fill="#4e4064" opacity="0.8"/>
    <circle cx="150" cy="300" r="15" fill="url(#wisp)"/>
    <circle cx="112" cy="262" r="12" fill="url(#wisp)"/>
    <circle cx="96" cy="218" r="9" fill="url(#wisp)"/>
    <g fill="#3b3350">
      <path d="M251 214 C226 186 196 168 160 170 C130 172 104 190 82 214 C112 202 140 198 166 204 C196 212 222 232 244 250 Z"/>
      <path d="M261 214 C286 186 316 168 352 170 C382 172 408 190 430 214 C400 202 372 198 346 204 C316 212 290 232 268 250 Z"/>
      <ellipse cx="256" cy="232" rx="13" ry="30"/>
      <circle cx="256" cy="198" r="10"/>
      <path d="M249 256 L238 292 L256 276 L274 292 L263 256 Z"/>
    </g>
  </g>
</svg>
`;
}

const rounded = icon(true);
const bleed = icon(false);
writeFileSync(join(out, 'icon.svg'), rounded);

const files = [
  ['icon-192.png', rounded, 192],
  ['icon-512.png', rounded, 512],
  ['icon-maskable-512.png', bleed, 512],
  ['apple-touch-icon.png', bleed, 180],
];

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage();
for (const [name, svg, size] of files) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  await page.screenshot({ path: join(out, name), omitBackground: true });
  console.log(`wrote public/icons/${name}`);
}
await browser.close();
