// Capture the rendered surfaces to docs/img/*.png.
//
//   node docs/screens.mjs && node docs/shoot.mjs
//
// Needs playwright and its one system library:
//   npm i -D playwright && npx playwright install chromium
//   sudo apt-get install -y libxkbcommon0     # Debian/Ubuntu, incl. Raspberry Pi
//
// Each page is shot at the width the tool actually gets inside the host panel
// (the overlay opens the iframe at 94vw), not at some arbitrary desktop size.
import fs from 'node:fs';
import { chromium } from 'playwright';

const dir = new URL('.', import.meta.url).pathname;
fs.mkdirSync(`${dir}img`, { recursive: true });

const SHOTS = [
  ['driver-types', 'Driver types — one list, grouped by part'],
  ['estimate', 'Estimate — Positions only, no cables'],
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
for (const [name, what] of SHOTS) {
  const file = `${dir}${name}.html`;
  if (!fs.existsSync(file)) {
    console.log(`skip ${name} — run docs/screens.mjs first`);
    continue;
  }
  await page.goto(`file://${file}`);
  // the framed area is the tool; the page around it is just the backdrop
  const frame = page.locator('.frame').first();
  await (await frame.count() ? frame : page).screenshot({ path: `${dir}img/${name}.png` });
  console.log(`docs/img/${name}.png — ${what}`);
}
await browser.close();
