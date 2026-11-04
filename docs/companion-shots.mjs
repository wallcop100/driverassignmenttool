// Screenshots for docs/companion.md: every companion surface in filling in a
// driver type, against a mocked companion.
//
//   VITE_ALLOWED_PARENT_ORIGINS=http://localhost:5200 npx vite --port 5200 &
//   node docs/companion-shots.mjs
//
// The parts below stand for what people have sent: one agreed, one still to
// check, an agreed amendment that names a supply, an unchecked amendment that
// disagrees with its datasheet, and a supply to check.
import fs from 'node:fs';
import { chromium } from 'playwright';

const dir = new URL('.', import.meta.url).pathname;
const IMG = `${dir}img`;
fs.mkdirSync(IMG, { recursive: true });

const agreed = { yes: 2, origins: 2 };
const once = { yes: 1, origins: 1 };
let parts = [
  { name: 'Tridonic LCA 50W one4all', aliases: ['LCA 50W'], powerType: 'CC', kind: 'driver', controlType: 'DALI',
    outputs: 1, addresses: 1, maxPowerW: 50, minA: 0.35, maxA: 1.05, maxFvV: 54, rev: 'r1', votes: agreed },
  { name: 'Lumotech LX 40/D', aliases: ['LX 40/D'], powerType: 'CC', kind: 'driver', controlType: 'DALI',
    maxPowerW: 40, minA: 0.2, maxA: 1.0, rev: 'r2', votes: once },
  { name: 'EldoLED LinearDrive 220D', powerType: 'CV', kind: 'dcdc', psu: 'Meanwell HLG-185-24',
    nodeMaxLoadW: 96, rev: 'r3', votes: agreed },
  { name: 'EldoLED SoloDrive 360/A', powerType: 'CC', kind: 'driver', maxPowerW: 36, rev: 'r4', votes: once },
  { name: 'Mean Well XLG-150-24', aliases: ['XLG-150-24'], powerType: 'CV', kind: 'supply', controlType: 'Local',
    outputs: 1, outputV: 24, maxPowerW: 150, rev: 'r5', votes: once },
];

// PW_CHROMIUM: a browser already on disk, when the installed Playwright wants a newer one
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const context = await browser.newContext({ viewport: { width: 1500, height: 1100 }, deviceScaleFactor: 2 });
const json = (route, body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
await context.route('**/companion/capabilities', (r) => json(r, { protocol: 'dat-companion/1', features: ['reports', 'opened', 'parts'] }));
await context.route('**/companion/opened', (r) => json(r, {}));
await context.route('**/companion/parts', (r) => {
  const vote = r.request().method() === 'POST' && r.request().postDataJSON()?.vote;
  if (vote) parts = parts.map((p) => (p.name === vote.name ? { ...p, votes: { yes: 2, origins: 2 } } : p));
  return json(r, { parts });
});
const page = await context.newPage();
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));

await page.goto('http://localhost:5200/harness.html');
await page.fill('#zone', 'HUB-C1');
await page.fill('#label', 'HUB-C1');
await page.fill('#set', String(900000 + Math.floor(Math.random() * 99999)));
await page.fill('#hub', 'p50123');
await page.waitForTimeout(1500);
await page.click('#send');
// pinned to the window once sent: the harness sizes it small
await page.evaluate(() => { document.getElementById('frame').style.cssText = 'position:fixed;left:0;top:0;width:1500px;height:1100px;z-index:9999'; });
await page.waitForTimeout(2000);
const f = page.frames().find((x) => x.url().includes('/api/'));
const wait = () => page.waitForTimeout(400);

// a button by its text, clicked in the page: some sit outside the frame's viewport
const click = async (sel, text) => {
  const ok = await f.evaluate(({ sel, text }) => {
    const label = (e) => [...e.childNodes].filter((n) => !n.classList?.contains('material-icons')).map((n) => n.textContent).join('').trim();
    const el = [...document.querySelectorAll(sel)].reverse().find((e) => label(e).startsWith(text));
    el?.click();
    return !!el;
  }, { sel, text });
  if (!ok) throw new Error(`no ${sel} "${text}"`);
  await wait();
};
const shot = async (name, sel = '.nt-dialog') => {
  await f.locator(sel).last().screenshot({ path: `${IMG}/${name}.png` });
  console.log(name);
};

await click('button', 'Carry on');            // the hub's banner, to the types page
await click('button', 'Carry on');            // the types page's banner, to the wizard

// ET-CCR-FEED-PROV: the part buttons mark what people sent
await click('.q-opt', '1 output');
await shot('companion-wizard-parts');

// a part still to check is asked about before anything fills in from it
await click('.q-opt', 'Lumotech LX 40/D');
await shot('companion-wizard-check');

// an agreed part fills in, marked Suggested with a flag to report it
await click('.q-crumb', 'Lumotech');
await click('.q-opt', 'Tridonic LCA 50W');
await click('.q-opt', '700 mA');
await shot('companion-wizard-suggested');

// ET-CVR-01, a LinearDrive 220D: its agreed supply is filled in as a crumb
await click('button', 'Skip');
await shot('companion-wizard-supply');
await click('.q-crumb', 'Meanwell');
await shot('companion-wizard-supplies');

// by hand: an agreed value is offered beside the datasheet, and a correction can be sent
await click('.q-opt', 'Meanwell HLG-185-24');
await click('button', 'Fill it in by hand');
await shot('companion-editor-suggested');
await click('button', 'Suggest a correction');
await shot('companion-share-card');

// a type no part fits: describe it, then suggest it as a catalogue part
while (await f.evaluate(() => !!document.querySelector('.preset-editor'))) await click('button', 'Cancel');
await click('button', 'Skip');
await f.fill('.q-other input', 'ZZ9000');
await f.press('.q-other input', 'Enter');
await wait();
await click('.q-none button', 'Fill in the columns');
await click('button', 'Suggest a catalogue part');
await shot('companion-share-new');

// an unchecked correction to a datasheet part is asked about in the type editor,
// and says where it disagrees with the datasheet
await click('button', 'close');
await f.evaluate(() => [...document.querySelectorAll('.tp-card')]
  .find((c) => c.querySelector('.tp-ref')?.textContent === 'ET-CCR-D-1050-1CH-01')
  .querySelector('button[title="Edit the fields"]').click());
await wait();
await f.locator('.shared-check').scrollIntoViewIfNeeded();
await shot('companion-editor-check', '.tp-card.is-editing');

// New type: parts people sent carry the sparkle
await page.keyboard.press('Escape');
await click('button', 'New type');
await click('button', 'See other driver types');
await shot('companion-new-type');

console.log('done');
await browser.close();
