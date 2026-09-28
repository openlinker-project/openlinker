/**
 * Captures one build of the product at four viewports, tagged by stage, so
 * three builds can be laid side by side against the SAME data.
 *
 *   node shoot-stage.mjs <stage-label>
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:38090';
const OUT = '/tmp/apw-screenshots/stages';
const stage = process.argv[2];
if (stage === undefined) throw new Error('usage: node shoot-stage.mjs <stage-label>');

const VIEWS = [
  { name: 'bench-desktop', path: '/bench', width: 1440, height: 1000, open: true },
  { name: 'bench-phone', path: '/bench', width: 390, height: 844, open: true },
  { name: 'assign-desktop', path: '/fulfillment/assign', width: 1440, height: 1000, open: false },
  { name: 'assign-phone', path: '/fulfillment/assign', width: 390, height: 844, open: false },
];

const browser = await chromium.launch();

for (const view of VIEWS) {
  const ctx = await browser.newContext({
    viewport: { width: view.width, height: view.height },
    hasTouch: view.width < 900,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  [${view.name}] page error`, e.message));

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('Username or email').fill('admin');
  await page.getByPlaceholder('Enter your password').fill('admin');
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(1600);

  await page.goto(`${BASE}${view.path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);

  if (view.open) {
    const open = page.getByRole('button', { name: 'Open parcel' });
    if ((await open.count()) > 0) {
      await open.first().click();
      await page.waitForTimeout(2200);
    }
  }

  const file = `${OUT}/${stage}--${view.name}.png`;
  await page.screenshot({ path: file, fullPage: view.width >= 900 });
  console.log(`  ${view.name} -> ${file}`);
  await ctx.close();
}

await browser.close();
console.log(`stage "${stage}" captured`);
