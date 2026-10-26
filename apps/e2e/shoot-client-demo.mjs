/**
 * Shoots the client-demo parcel at every width (#3340 follow-up).
 *
 * Opens the seeded `OL-DEMO-1001` parcel specifically, rather than whichever
 * one happens to be first — that is the only parcel on the stack carrying a
 * real invoice and a real label.
 *
 *   node shoot-client-demo.mjs [label]
 */
import { chromium } from 'playwright';

const BASE = process.env.OL_DEMO_WEB ?? 'http://localhost:38090';
const OUT = '/tmp/apw-screenshots/stages';
const TAG = process.argv[2] ?? 'demo';
const ORDER_NUMBER = 'OL-DEMO-1001';

const VIEWS = [
  { name: 'desktop', width: 1440, height: 1200 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'phone', width: 390, height: 844 },
];

const browser = await chromium.launch();

for (const view of VIEWS) {
  const ctx = await browser.newContext({
    viewport: { width: view.width, height: view.height },
    hasTouch: view.width < 900,
  });

  await ctx.addInitScript(() => {
    if (!('BarcodeDetector' in window)) {
      class StubBarcodeDetector {
        static getSupportedFormats() {
          return Promise.resolve(['ean_13', 'ean_8', 'code_128', 'qr_code']);
        }
        detect() {
          return Promise.resolve([]);
        }
      }
      Object.defineProperty(window, 'BarcodeDetector', { value: StubBarcodeDetector });
    }
  });

  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  [${view.name}] page error`, e.message));

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('Username or email').fill(process.env.OL_DEMO_USER ?? 'admin');
  await page.getByPlaceholder('Enter your password').fill(process.env.OL_DEMO_PASS ?? 'admin');
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(1700);

  await page.goto(`${BASE}/bench`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);

  // Find the demo parcel by its order number rather than by position, so a
  // re-seed that changes the rail's ordering does not silently shoot a
  // different box.
  const row = page.locator('.bench-work-row', { hasText: ORDER_NUMBER });
  const found = (await row.count()) > 0;
  if (found) {
    await row.first().getByRole('button', { name: 'Open parcel' }).click();
    await page.waitForTimeout(2500);
  }
  console.log(`  ${view.name}: ${ORDER_NUMBER} ${found ? 'opened' : 'NOT FOUND in the rail'}`);

  await page.screenshot({
    path: `${OUT}/${TAG}--clientdemo-${view.name}.png`,
    fullPage: view.width >= 900,
  });
  await ctx.close();
}

await browser.close();
console.log('done');
