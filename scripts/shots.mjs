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
  // Neon Bay (default seed). `place` parks the bird at a viewpoint and freezes the frame.
  { name: 'city-title', query: '?level=city', wait: 4500 },
  {
    name: 'city-canyon',
    query: '?level=city&autopilot',
    wait: 3000,
    place: { x: 0, y: 24, z: -150, yaw: Math.PI, phase: 0.68 },
  },
  {
    name: 'city-night',
    query: '?level=city&autopilot',
    wait: 3000,
    place: { x: 0, y: 30, z: -100, yaw: Math.PI, phase: 0.86 },
  },
  {
    name: 'city-temple',
    query: '?level=city&autopilot',
    wait: 3000,
    place: { x: -370, y: 38, z: 20, yaw: -2.36, pitch: -0.3, phase: 0.6 },
  },
  {
    name: 'city-tower',
    query: '?level=city&autopilot',
    wait: 3000,
    place: { x: 600, y: 70, z: -380, yaw: 2.5, pitch: 0.15, phase: 0.72 },
  },
  {
    name: 'city-expressway',
    query: '?level=city&autopilot',
    wait: 3000,
    place: { x: -475, y: 10, z: -200, yaw: Math.PI, phase: 0.7 },
  },
  // Jade River (default seed).
  { name: 'karst-title', query: '?level=karst', wait: 4500 },
  {
    name: 'karst-river',
    query: '?level=karst&autopilot',
    wait: 3000,
    place: { x: 0, y: 18, z: 0, yaw: 0, phase: 0.03 },
  },
  {
    name: 'karst-mist',
    query: '?level=karst&autopilot',
    wait: 3000,
    place: { x: 0, y: 230, z: -200, yaw: 0.3, pitch: -0.25, phase: 0.05 },
  },
  {
    name: 'karst-golden',
    query: '?level=karst&autopilot',
    wait: 3000,
    place: { x: 200, y: 60, z: 300, yaw: 2.2, phase: 0.5 },
  },
  {
    name: 'karst-night',
    query: '?level=karst&autopilot',
    wait: 3000,
    place: { x: 223, y: 17, z: 139, yaw: 1.2, phase: 0.86 },
  },
];

/** Park the bird at a viewpoint (paused, so nothing moves), build the world around it. */
function place(p) {
  const g = window.__dw;
  g.setMode('paused');
  Object.assign(g.flight, { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch ?? 0, bank: 0 });
  g.flight.pitchSpring.x = p.pitch ?? 0;
  for (const k of ['x', 'y', 'z', 'yaw', 'pitch', 'bank']) g.prev[k] = g.flight[k];
  g.day.setPhase(p.phase);
  g.world.prime(p.x, p.z);
  g.chase.snap();
  document.getElementById('ui').style.display = 'none';
}

// Real GPU where available (much faster); SwiftShader elsewhere.
const angle = process.platform === 'win32' ? 'd3d11' : 'swiftshader';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH, // optional: a system Chromium instead of Playwright's
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
  if (s.place) {
    await page.waitForTimeout(1500);
    await page.evaluate(place, s.place);
  }
  await page.waitForTimeout(s.wait);
  await page.screenshot({ path: `${out}/${s.name}.jpg`, type: 'jpeg', quality: 82 });
  console.log('saved', `${out}/${s.name}.jpg`);
  await ctx.close();
}
await browser.close();
