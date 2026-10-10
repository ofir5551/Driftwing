// README screenshots: node scripts/shots.mjs [baseUrl] [outDir]
// Needs a running server (`npm run dev` or `npm run preview`). Writes JPEGs.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'docs/screenshots';
mkdirSync(out, { recursive: true });

const shots = [
  { name: 'title', query: '?time=0.06', wait: 3500 },
  { name: 'day', query: '?autopilot&time=0.3', wait: 7000 },
  { name: 'golden', query: '?autopilot&time=0.52&seed=7', wait: 7000 },
  { name: 'dusk', query: '?autopilot&time=0.7', wait: 7000 },
  { name: 'twilight', query: '?autopilot&time=0.9&seed=21', wait: 7000 },
  {
    name: 'mobile',
    query: '?autopilot&time=0.4',
    wait: 6000,
    viewport: { width: 390, height: 844 },
    mobile: true,
  },
];

// Real GPU where available (much faster); SwiftShader elsewhere.
const angle = process.platform === 'win32' ? 'd3d11' : 'swiftshader';
const browser = await chromium.launch({
  args: [`--use-angle=${angle}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
for (const s of shots) {
  const ctx = await browser.newContext({
    viewport: s.viewport ?? { width: 1280, height: 720 },
    hasTouch: !!s.mobile,
    isMobile: !!s.mobile,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${s.name}] pageerror:`, e.message));
  await page.goto(base + s.query);
  await page.waitForTimeout(s.wait);
  await page.screenshot({ path: `${out}/${s.name}.jpg`, type: 'jpeg', quality: 82 });
  console.log('saved', `${out}/${s.name}.jpg`);
  await ctx.close();
}
await browser.close();
