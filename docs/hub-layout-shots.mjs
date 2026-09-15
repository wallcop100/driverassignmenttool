// Screenshots and real patch rows for docs/hub-layout.md.
//
//   npx vite --port 5200 & VITE_ALLOWED_PARENT_ORIGINS=http://localhost:5200
//   node docs/hub-layout-shots.mjs
//
// Each scenario is built in the harness, photographed into docs/img/hub-*.png, and
// the patch it produces is saved to docs/img/hub-*.patch.txt, so every Parameters
// and ContextParameters example in the doc is what the tool actually writes.
//
// Drags are dispatched inside the tool's frame: Playwright's own mouse does not
// reach the harness iframe's drawing.
import fs from 'node:fs';
import { chromium } from 'playwright';

const dir = new URL('.', import.meta.url).pathname;
const IMG = `${dir}img`;
fs.mkdirSync(IMG, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));

async function open(zone, { estimate = false } = {}) {
  await page.goto('http://localhost:5200/harness.html');
  await page.evaluate(() => {
    const f = document.getElementById('frame'); f.width = 1400; f.height = 1000;
    window.__patch = null;
    addEventListener('message', (e) => { if (e.data?.type === 'dat:export') window.__patch = e.data.content; });
  });
  await page.fill('#zone', zone);
  await page.fill('#label', zone);
  await page.fill('#set', String(900000 + Math.floor(Math.random() * 99999)));
  await page.fill('#hub', estimate ? 'p60001' : 'p50123');
  if (estimate) await page.check('#estimate');
  await page.waitForTimeout(1500);
  await page.click('#send');
  await page.waitForTimeout(2000);
  const frame = page.frames().find((x) => x.url().includes('/api/'));
  await frame.locator('.space-link').first().click({ timeout: 15000 });
  await frame.waitForSelector('.hub-tray', { timeout: 15000 });
  await page.waitForTimeout(400);
  return frame;
}

// press on the n-th block (or a tray row), release over a point of the first sheet
const drag = (frame, pick, where) => frame.evaluate(async ({ pick, where }) => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const el = pick.tray
    ? [...document.querySelectorAll('.hub-tray-item')].find((e) => e.textContent.includes(pick.tray))
    : document.querySelectorAll('.hub-svg .hub-g')[pick.block];
  if (!el) return false;
  const r = document.querySelector('.hub-svg').getBoundingClientRect();
  const x = where === 'right' ? r.right - 50 : r.left + 110;
  const y = r.top + 40;
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await wait(80);
  document.elementFromPoint(x, y).dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y }));
  await wait(300);
  return true;
}, { pick, where });

async function shot(frame, css, name) {
  const el = frame.locator(css).first();
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  await el.screenshot({ path: `${IMG}/${name}.png` });
  console.log(`docs/img/${name}.png`);
}

async function patch(frame, name) {
  await page.evaluate(() => { window.__patch = null; });
  await frame.locator('button', { hasText: 'Copy patch' }).click();
  await page.waitForTimeout(700);
  const text = await page.evaluate(() => window.__patch) ?? '';
  fs.writeFileSync(`${IMG}/${name}.patch.txt`, text);
  console.log(`docs/img/${name}.patch.txt (${text.length} chars)`);
}

// 1. a hub nobody has laid out: known drivers placed, feeds waiting in the tray
let f = await open('HUB-A');
await shot(f, '.hub-sheets', 'hub-not-laid-out');
await shot(f, '.hub-tray', 'hub-tray');
await patch(f, 'hub-not-laid-out');

// 2. two bays standing together
f = await open('HUB-C1');
await f.locator('.hub-controls .hub-bays button', { hasText: '+' }).click();
await page.waitForTimeout(200);
for (let n = 0; n < 3; n += 1) await drag(f, { block: 0 }, 'right');
await shot(f, '.hub-sheets', 'hub-two-bays');
await patch(f, 'hub-two-bays');

// 3. the second bay separated: two pieces, recorded as space groups
await f.locator('.hub-baytab .kebab-btn').nth(1).click();
await f.locator('.hub-baymenu label', { hasText: 'Separate' }).locator('input').check();
// close the menu from inside the tool: a click on the harness page never reaches it
await f.locator('.hub-legend').click({ position: { x: 5, y: 5 } });
await page.waitForTimeout(250);
await shot(f, '.hub-sheets', 'hub-separate-spaces');
await patch(f, 'hub-separate-spaces');

// 4. the same with enclosure Elements on, one per piece
await f.locator('.hub-check input').check();
await page.waitForTimeout(200);
await f.locator('.hub-piece-ref input').first().fill('E90214');
await page.waitForTimeout(150);
await shot(f, '.hub-sheets', 'hub-separate-enclosures');
await patch(f, 'hub-separate-enclosures');

// 5. a turned driver
f = await open('HUB-B2');
await f.locator('.hub-svg .hub-g').nth(1).dispatchEvent('mousedown');
await f.locator('.hub-lab').dispatchEvent('mouseup');
await f.locator('.hub-controls button', { hasText: 'Rotate' }).click();
await page.waitForTimeout(250);
await shot(f, '.hub-sheets', 'hub-turned');
await patch(f, 'hub-turned');

// 6. one row standing for four drivers, then broken apart
// the turned shot above already shows the stack (E50028 x4)
const stack = f.locator('.hub-svg .hub-g', { has: f.locator('.hub-stack') }).first();
await stack.dispatchEvent('mousedown');
await f.locator('.hub-lab').dispatchEvent('mouseup');
await f.locator('.hub-controls button', { hasText: 'Break apart' }).click();
await page.waitForTimeout(400);
await shot(f, '.hub-sheets', 'hub-quantity-broken');
await patch(f, 'hub-quantity-broken');

// 7. a CV driver's parts, and its junction boxes
f = await open('HUB-A');
const mods = f.locator('.hub-svg .hub-g');
let cv = null;
for (let i = 0; i < await mods.count(); i += 1) {
  const t = await mods.nth(i).locator('title').first().textContent();
  if (/HLG|220D|ET-CVR/i.test(t)) { cv = mods.nth(i); break; }
}
await cv.locator('.hub-pencil').dispatchEvent('mousedown');
await f.waitForSelector('.hub-dock .pe', { timeout: 5000 });
const rows = f.locator('.pe-table tbody tr');
for (let i = 0; i < await rows.count(); i += 1) {
  if (await rows.nth(i).locator('select').inputValue() === 'PSU') await rows.nth(i).locator('input[type=number]').nth(3).fill('10');
}
await f.locator('.pe-foot .hub-bays button', { hasText: /^2$/ }).click();
await page.waitForTimeout(250);
// the docked editor is full height; only its content is worth a picture
{
  const top = await f.locator('.hub-dock').boundingBox();
  const end = await f.locator('.hub-dock .hub-inspect-flags').boundingBox();
  await page.screenshot({ path: `${IMG}/hub-part-editor.png`, clip: { x: top.x, y: top.y, width: top.width, height: end.y + end.height + 16 - top.y } });
  console.log('docs/img/hub-part-editor.png');
}
const toType = f.locator('.pe-ask button', { hasText: 'The type' });
if (await toType.count()) await toType.click(); else await f.locator('.pe-foot button', { hasText: /Save|Accept/ }).click();
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await shot(f, '.hub-sheets', 'hub-cv-parts');
await patch(f, 'hub-cv-parts');

// 8. an early design: Elements and no cables, nothing placed but the drivers
f = await open('HUB-J', { estimate: true });
await shot(f, '.hub-sheets', 'hub-early-design');
await shot(f, '.hub-tray', 'hub-early-tray');
await patch(f, 'hub-early-design');

await browser.close();
