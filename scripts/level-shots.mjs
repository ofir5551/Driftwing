// Review a level in one go: node scripts/level-shots.mjs <level> [--base URL] [--out DIR]
//   [--at x,y,z,yaw[,pitch[,phase]]]...
// Needs a running server (`npm run dev`). Shoots the title (desktop and phone), then views
// framed from the level's spawn at dawn, golden hour, night and from altitude, plus any --at
// viewpoints. Prints Game.info() per view and the heaviest instanced meshes (triangles).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const level = args[0];
if (!level || level.startsWith('--')) {
  console.log(
    'usage: node scripts/level-shots.mjs <level> [--base URL] [--out DIR] [--at x,y,z,yaw[,pitch[,phase]]]',
  );
  process.exit(1);
}
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i < 0 ? dflt : args[i + 1];
};
const base = flag('--base', 'http://localhost:5173/');
const out = flag('--out', `shots/${level}`);
const extra = args.flatMap((a, i) => (a === '--at' ? [args[i + 1].split(',').map(Number)] : []));
mkdirSync(out, { recursive: true });

/**
 * Views relative to the spawn: [name, metres ahead, height, yaw offset, pitch, day phase].
 * Altitude looks back over the start from behind and above.
 */
const VIEWS = [
  ['dawn', 0, null, 0, 0, 0.03],
  ['golden', 150, 60, 0.8, 0, 0.5],
  ['night', 100, null, 0, 0, 0.86],
  ['altitude', -200, 230, 0, -0.25, 0.05],
];

/** Park the bird (paused) at a viewpoint and build the world around it. */
function place(p) {
  const g = window.__dw;
  g.setMode('paused');
  Object.assign(g.flight, { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, bank: 0 });
  g.flight.pitchSpring.x = p.pitch;
  for (const k of ['x', 'y', 'z', 'yaw', 'pitch', 'bank']) g.prev[k] = g.flight[k];
  g.day.setPhase(p.phase);
  g.world.prime(p.x, p.z);
  g.chase.snap();
  document.getElementById('ui').style.display = 'none';
}

/** Triangles x instances for every instanced mesh in the level, heaviest first. */
function meshCost() {
  const rows = [];
  window.__dw.world.group.traverse((o) => {
    if (!o.isInstancedMesh || !o.count) return;
    const g = o.geometry;
    const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
    rows.push([o.name || '(unnamed)', tris, o.count, tris * o.count]);
  });
  return rows.sort((a, b) => b[3] - a[3]).slice(0, 8);
}

// Real GPU on Windows (much faster); SwiftShader elsewhere.
const angle = process.platform === 'win32' ? 'd3d11' : 'swiftshader';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: [`--use-angle=${angle}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

async function shoot(name, viewport, place_) {
  const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 600 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] pageerror:`, e.message));
  await page.goto(`${base}?level=${level}${place_ ? '&autopilot' : ''}`);
  await page.waitForFunction(() => window.__dw, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  if (place_) {
    const spawn = await page.evaluate(() => window.__dw.spawn);
    await page.evaluate(place, place_(spawn));
  }
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/${name}.png` });
  const info = await page.evaluate(() => window.__dw.info());
  console.log(`${name}: ${out}/${name}.png`, JSON.stringify(info));
  if (name === 'dawn')
    console.log(
      'heaviest meshes [name, tris, instances, total]:',
      JSON.stringify(await page.evaluate(meshCost)),
    );
  await ctx.close();
}

await shoot('title', { width: 1280, height: 720 });
await shoot('title-phone', { width: 390, height: 844 });
for (const [name, ahead, y, dyaw, pitch, phase] of VIEWS)
  await shoot(name, { width: 1280, height: 720 }, (s) => ({
    x: s.x + Math.sin(s.yaw) * ahead,
    y: y ?? s.y,
    z: s.z + Math.cos(s.yaw) * ahead,
    yaw: s.yaw + dyaw,
    pitch,
    phase,
  }));
for (const [i, [x, y, z, yaw, pitch = 0, phase = 0.3]] of extra.entries())
  await shoot(`at-${i}`, { width: 1280, height: 720 }, () => ({ x, y, z, yaw, pitch, phase }));
await browser.close();
