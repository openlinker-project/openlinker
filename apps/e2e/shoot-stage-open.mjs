/**
 * The companion to shoot-stage.mjs: opens an UNPACKED parcel, so the shot
 * shows the scanning state rather than a closed box.
 *
 *   node shoot-stage-open.mjs <stage-label>
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:38090';
const OUT = '/tmp/apw-screenshots/stages';
const stage = process.argv[2];
if (stage === undefined) throw new Error('usage: node shoot-stage-open.mjs <stage-label>');

const VIEWS = [
  { name: 'bench-open-desktop', width: 1440, height: 1100 },
  { name: 'bench-open-phone', width: 390, height: 844 },
];

const browser = await chromium.launch();

for (const view of VIEWS) {
  const ctx = await browser.newContext({
    viewport: { width: view.width, height: view.height },
    hasTouch: view.width < 900,
  });
  // Headless Chromium ships no BarcodeDetector, so without this the dock
  // correctly reports "this browser cannot read a barcode". A real Android
  // Chrome at a bench HAS one, which is the device these shots stand for.
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
  await page.getByPlaceholder('Username or email').fill('admin');
  await page.getByPlaceholder('Enter your password').fill('admin');
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(1600);

  await page.goto(`${BASE}/bench`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);

  // The demo stack's second work (demo-work-bench-0002) is the one with
  // unscanned units; the first is already packed.
  const controls = page.getByRole('button', { name: 'Open parcel' });
  const count = await controls.count();
  const index = count > 1 ? 1 : 0;
  if (count > 0) {
    await controls.nth(index).click();
    await page.waitForTimeout(2400);
  }
  console.log(`  ${view.name}: ${String(count)} open controls, clicked #${String(index)}`);

  await page.screenshot({
    path: `${OUT}/${stage}--${view.name}.png`,
    fullPage: view.width >= 900,
  });
  await ctx.close();
}

await browser.close();
console.log(`stage "${stage}" open-parcel captured`);
