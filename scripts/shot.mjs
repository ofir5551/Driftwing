// One-off screenshot: node scripts/shot.mjs <url> <out.png> [waitMs] [clickSelector] [w] [h]
import { chromium } from 'playwright';
const [url, out, wait = '2000', click = '', w = '1280', h = '720'] = process.argv.slice(2);
const b = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH, // optional: a system Chromium instead of Playwright's
  args: [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const p = await b.newPage({ viewport: { width: +w, height: +h } });
p.on(
  'console',
  (m) => (m.type() === 'error' || m.type() === 'warning') && console.log('console:', m.text()),
);
p.on('pageerror', (e) => console.log('pageerror:', e.message));
await p.goto(url);
await p.waitForTimeout(800);
if (click) await p.click(click).catch((e) => console.log('click fail', e.message));
await p.waitForTimeout(+wait);
await p.screenshot({ path: out });
const info = await p.evaluate(() => window.__dw?.info?.() ?? null).catch(() => null);
if (info) console.log(JSON.stringify(info));
await b.close();
