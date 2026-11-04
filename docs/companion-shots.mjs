// Screenshots for docs/companion.md, filling in driver types against a mocked
// companion, and a check of every body the answers send (learn.js).
//
//   VITE_ALLOWED_PARENT_ORIGINS=http://localhost:5200 npx vite --port 5200 &
//   node docs/companion-shots.mjs
//
// The parts below stand for what people have sent: a part one other person
// entered, an agreed amendment to the LinearDrive 220D that names its supply,
// and an unchecked amendment to the SoloDrive 360/A. The harness's types gain a
// ControlType column and a few rows, so a family forms on the shared part, a
// SoloDrive states DMX where its datasheet says DALI, and one product is in no
// catalogue at all.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const dir = new URL('.', import.meta.url).pathname;
const IMG = `${dir}img`;
fs.mkdirSync(IMG, { recursive: true });

const once = { yes: 1, no: 0, origins: 1, openNo: false, verdict: null };
const agreed = { ...once, yes: 2, origins: 2 };
let parts = [
  { name: 'TCI MP 32 HV K2', powerType: 'CC', kind: 'driver', controlType: 'DALI', outputs: 1, addresses: 1,
    maxPowerW: 32, minA: 0.35, maxA: 0.7, maxFvV: 46, windows: [{ a: 0.35, w: 19, fv: 54 }, { a: 0.7, w: 32, fv: 46 }],
    rev: 'r1', votes: once },
  { name: 'EldoLED LinearDrive 220D', powerType: 'CV', kind: 'dcdc', psu: 'Meanwell HLG-185-24',
    nodeMaxLoadW: 96, rev: 'r3', votes: agreed },
  { name: 'EldoLED SoloDrive 360/A', powerType: 'CC', kind: 'driver', maxPowerW: 36, rev: 'r4', votes: once },
];
const TYPES = [
  'ET-CCR-S-350-1CH-01,TCI MP 32 HV K2 - 350mA,OP.1,,,,,0,0,',
  'ET-CCR-S-700-1CH-01,TCI MP 32 HV K2 - 700mA,OP.1,,,,,0,0,',
  'ET-CCR-D-500-1CH-01,EldoLED SOLODrive 360/A at 500mA,OP.1,,,,,0,0,DMX',
  'ET-CCR-S-400-1CH-01,Acme Widget 40 - 400mA,OP.1,,,,,0,0,',
  'ET-CCR-S-800-1CH-01,Acme Widget 40 - 800mA,OP.1,,,,,0,0,',
];

// PW_CHROMIUM: a browser already on disk, when the installed Playwright wants a newer one
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const context = await browser.newContext({ viewport: { width: 1500, height: 1100 }, deviceScaleFactor: 2 });
const json = (route, body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
await context.route('**/harness.html', async (r) => {
  const res = await r.fetch();
  const body = (await res.text()).replace(/(const TYPES_CSV = `)([\s\S]*?)`/, (m, head, csv) => {
    const rows = csv.trim().split('\n');
    return `${head}${rows[0]},ControlType\n${[...rows.slice(1).map((l) => `${l},`), ...TYPES].join('\n')}\n\``;
  });
  return r.fulfill({ response: res, body });
});
await context.route('**/companion/capabilities', (r) => json(r, { protocol: 'dat-companion/1', features: ['reports', 'opened', 'parts'] }));
await context.route('**/companion/opened', (r) => json(r, {}));
const posts = [];
await context.route('**/companion/parts', (r) => {
  if (r.request().method() === 'POST') {
    const b = r.request().postDataJSON();
    posts.push(b);
    if (b.vote) parts = parts.map((p) => (p.name === b.vote.name ? { ...p, votes: agreed } : p));
  }
  return json(r, { parts });
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

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
const sent = () => posts.splice(0);

await click('button', 'Carry on');            // the hub's banner, to the types page
await click('button', 'Carry on');            // the types page's banner, to the wizard

// a family on a part one other person entered: the yes is its second vote
await shot('companion-family');
await click('button', 'Yes, all 2');
assert.deepEqual(sent(), [{ vote: { name: 'TCI MP 32 HV K2', rev: 'r1', vote: 'confirmed' } }]);

// a SoloDrive that says DMX: set aside, then "its own values are right" asks why, per value
await click('.nt-dialog button', 'Not right');
await click('.nt-dialog button', 'None of these');
await click('.tr-step', 'Review');
await click('.nt-dialog button', 'It is a EldoLED SoloDrive 360/A');
await click('.rv-reasons button', "The datasheet's wrong");
await shot('companion-reasons');
await click('.nt-dialog button', 'Keep its own values');
const [own] = sent();
assert.deepEqual(own.reason, { name: 'EldoLED SoloDrive 360/A', values: { controlType: 'datasheet' } });
assert.equal(own.part.controlType, 'DMX');
assert.equal(own.part.maxPowerW, 30, "the datasheet's, not the unchecked amendment's 36");

// a product no catalogue has, filled in by hand for both its currents: sent as a part
await f.locator('.nt-dialog button:has-text("Fill it in by hand")').nth(1).click();
await wait();
const box = f.locator('.preset-editor input');
await box.nth(0).fill('20');      // MaxPower(W)
await box.nth(1).fill('0.4');     // CurrentRange
await box.nth(3).fill('DALI');    // ControlType
await click('.nt-dialog button', 'Save');
assert.deepEqual(sent(), [{ part: { name: 'Acme Widget 40', aliases: [], kind: 'driver', powerType: 'CC', maxPowerW: 20,
  minA: 0.4, maxA: 0.8, outputs: 1, controlType: 'DALI' } }]);

// an unchecked amendment is asked about in the type editor, and says where it
// disagrees with the datasheet
await click('.nt-dialog button', 'Done');
const edit = async (ref) => {
  await f.evaluate((ref) => [...document.querySelectorAll('.tp-card')]
    .find((c) => c.querySelector('.tp-ref')?.textContent === ref)
    .querySelector('button[title="Edit the fields"]').click(), ref);
  await wait();
};

// in the type editor, an agreed value the datasheet lacks is offered under its field
await edit('ET-CVR-01');
await shot('companion-editor-suggested', '.tp-card.is-editing');
await click('.tp-card.is-editing button', 'Cancel');

await edit('ET-CCR-D-1050-1CH-01');
await f.locator('.shared-check').scrollIntoViewIfNeeded();
await shot('companion-editor-check', '.tp-card.is-editing');

assert.deepEqual(sent(), [], 'looking sends nothing');
assert.deepEqual(errors, []);
console.log('done');
await browser.close();
