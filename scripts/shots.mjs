// Screenshot helper: node scripts/shots.mjs [baseUrl] [outDir]
// Starts nothing itself; run `npm run dev` (or `npm run preview`) first.
// Each shot: load a URL, optionally click Play, fly for a while, capture.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'shots';
mkdirSync(out, { recursive: true });

const shots = [
  { name: 'start', query: '', play: false, wait: 2500 },
  { name: 'flight', query: '?autopilot', play: true, wait: 6000 },
  { name: 'golden', query: '?autopilot&time=0.55', play: true, wait: 6000 },
  { name: 'dusk', query: '?autopilot&time=0.8', play: true, wait: 6000 },
  {
    name: 'mobile',
    query: '?autopilot',
    play: true,
    wait: 5000,
    viewport: { width: 390, height: 844 },
  },
];

const browser = await chromium.launch({
  args: [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
for (const s of shots) {
  const page = await browser.newPage({ viewport: s.viewport ?? { width: 1280, height: 720 } });
  page.on('console', (m) => m.type() === 'error' && console.log(`[${s.name}] console:`, m.text()));
  page.on('pageerror', (e) => console.log(`[${s.name}] pageerror:`, e.message));
  await page.goto(base + s.query);
  await page.waitForTimeout(800);
  if (s.play) await page.click('#play-btn').catch(() => {});
  await page.waitForTimeout(s.wait);
  await page.screenshot({ path: `${out}/${s.name}.png` });
  console.log('saved', `${out}/${s.name}.png`);
  await page.close();
}
await browser.close();
