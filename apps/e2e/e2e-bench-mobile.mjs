/**
 * Full pack-bench run on a REAL order, as the new packer, on a phone.
 *
 * The camera's DECODER is stubbed (headless Chromium ships none) while the
 * camera PATH is real: a fake media device, a real `getUserMedia`, a real
 * stream in the viewfinder, and a real read arriving through the same
 * `onScanValue` a wedge scanner uses. Everything else is the product.
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:38090';
const OUT = '/tmp/apw-screenshots';
const PACKER = { user: 'anna.pakowska', pass: 'Pakowanie!2026' };

const step = (n, what) => console.log(`\n[${n}] ${what}`);

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  permissions: ['camera'],
});

// A decoder headless Chromium does not have. Reads whatever the page asks it
// to next, so the test drives WHICH code is seen while the stream, the
// permission and the plumbing are real.
await ctx.addInitScript(() => {
  window.__nextBarcode = null;
  class BarcodeDetector {
    static getSupportedFormats() {
      return Promise.resolve(['ean_13', 'code_128', 'qr_code']);
    }
    detect() {
      const value = window.__nextBarcode;
      return Promise.resolve(value === null ? [] : [{ rawValue: value }]);
    }
  }
  window.BarcodeDetector = BarcodeDetector;
});

const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [page error]', e.message));

step(1, 'Packer signs in');
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.getByPlaceholder('Username or email').fill(PACKER.user);
await page.getByPlaceholder('Enter your password').fill(PACKER.pass);
await page.locator('button[type="submit"]').first().click();
await page.waitForTimeout(2000);
console.log('  signed in, url:', page.url());

step(2, 'The bench work list');
await page.goto(`${BASE}/bench`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/e2e-01-list.png` });
const rows = page.locator('[data-testid="bench-work-row"]');
console.log('  parcels on the rail:', await rows.count());
if ((await rows.count()) > 0) {
  console.log('  first row:', (await rows.first().innerText()).replace(/\s+/g, ' ').slice(0, 110));
}

const open = page.getByRole('button', { name: 'Open parcel' });
if ((await open.count()) === 0) {
  console.log('  NO OPENABLE PARCEL — stopping so the failure is visible');
  await browser.close();
  process.exit(1);
}

step(3, 'Open the box');
// Pick a box with units still to scan, so the run exercises the whole flow
// rather than landing on one a previous run already finished.
const openCount = await open.count();
let picked = 0;
for (let i = 0; i < openCount; i += 1) {
  const row = rows.nth(i);
  if ((await row.innerText()).includes('units to scan')) {
    picked = i;
    break;
  }
}
await open.nth(picked).click();
await page.waitForTimeout(2500);
const ref = (await page.locator('.bench-parcel__reference').first().innerText()).trim().split('\n')[0];
console.log('  order:', ref);
await page.screenshot({ path: `${OUT}/e2e-02-parcel.png` });

step(4, 'The item switcher');
const handle = page.locator('.bench-dock__handle');
await handle.click();
await page.waitForTimeout(600);
const items = page.locator('[data-testid="bench-dock-items"] .bench-dock__item');
console.log('  items in the box:', await items.count());
for (let i = 0; i < (await items.count()); i += 1) {
  console.log('   ·', (await items.nth(i).innerText()).replace(/\s+/g, ' ').slice(0, 80));
}
await page.screenshot({ path: `${OUT}/e2e-03-switcher.png` });
await handle.click();
await page.waitForTimeout(400);

step(5, 'Read the active item, then scan it with the camera');
const before = (await page.locator('.bench-dock__count').innerText()).replace(/\s+/g, ' ');
console.log('  count before:', before);
const codes = (await page.locator('.bench-dock__strip-codes').innerText()).replace(/\s+/g, ' ');
console.log('  identifiers on the dock:', codes);
// EAN if the line has one; otherwise the SKU, which is what a shop that
// labels its own goods prints as Code-128. The matcher accepts ean, gtin or
// sku, so either is a real scan.
const ean =
  (codes.match(/\b\d{8,14}\b/) ?? [])[0] ??
  (codes.match(/SKU\s+([^\s·]+)/) ?? [])[1] ??
  null;
console.log('  barcode to read:', ean ?? '(none on this line)');

const cameraBtn = page.getByRole('button', { name: 'Scan with camera' });
console.log('  camera offered:', (await cameraBtn.count()) > 0);
if ((await cameraBtn.count()) > 0 && ean !== null) {
  await page.evaluate((code) => {
    window.__nextBarcode = code;
  }, ean);
  await cameraBtn.click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/e2e-04-camera.png` });
  const viewfinder = page.locator('[data-testid="bench-camera"]');
  console.log('  viewfinder open:', (await viewfinder.count()) > 0);
  const read = page.locator('[data-testid="bench-camera-read"]');
  if ((await read.count()) > 0) console.log('  read:', (await read.innerText()).replace(/\s+/g, ' '));
  // Stop reading, close the camera, and see what the count did.
  await page.evaluate(() => {
    window.__nextBarcode = null;
  });
  // The camera closes ITSELF when the box closes, so this is conditional:
  // clicking a control that is already gone is a test bug, not a defect.
  const closeBtn = page.getByRole('button', { name: 'Close the camera' });
  if ((await closeBtn.count()) > 0) {
    await closeBtn.click();
    await page.waitForTimeout(1500);
  } else {
    console.log('  camera closed itself (the box finished)');
  }
}
const countAfter = page.locator('.bench-dock__count');
const after =
  (await countAfter.count()) > 0
    ? (await countAfter.innerText()).replace(/\s+/g, ' ')
    : '(box finished - the dock shows no count)';
console.log('  count after:', after);
await page.screenshot({ path: `${OUT}/e2e-05-after-scan.png` });

step(6, 'Box-level progress');
const progress = page.locator('.bench-parcel__progress-top');
if ((await progress.count()) > 0) {
  console.log('  progress:', (await progress.innerText()).replace(/\s+/g, ' '));
}

step(6.5, 'Scan the rest so the box closes itself');
for (let i = 0; i < 12; i += 1) {
  const closed = await page.locator('[data-testid="bench-parcel-closed"]').count();
  if (closed > 0) break;
  const field = page.getByLabel('Scan this item');
  if ((await field.count()) === 0) break;
  await field.fill(ean ?? '');
  await field.press('Enter');
  await page.waitForTimeout(1200);
}
const closedNow = (await page.locator('[data-testid="bench-parcel-closed"]').count()) > 0;
console.log('  box closed itself:', closedNow);
if (closedNow) {
  console.log('  closed panel:', (await page.locator('[data-testid="bench-parcel-closed"]').innerText()).replace(/\s+/g, ' ').slice(0, 160));
  await page.screenshot({ path: `${OUT}/e2e-06-closed.png`, fullPage: true });
}
const docs = page.locator('[data-testid="bench-documents"]');
if ((await docs.count()) > 0) {
  console.log('  documents:', (await docs.innerText()).replace(/\s+/g, ' ').slice(0, 200));
}

step(7, 'The work-list sheet, without leaving the box');
await handle.click();
await page.waitForTimeout(400);
const switchLink = page.getByRole('button', { name: /switch to another parcel/i });
if ((await switchLink.count()) > 0) {
  await switchLink.click();
  await page.waitForTimeout(1200);
  console.log('  sheet open:', (await page.locator('[data-testid="bench-list-sheet"]').count()) > 0);
  await page.screenshot({ path: `${OUT}/e2e-06-sheet.png` });
  await page.getByRole('button', { name: /back to the box/i }).click();
  await page.waitForTimeout(800);
  console.log('  back on the box, dock still there:', (await page.locator('[data-testid="bench-dock"]').count()) > 0);
  const c = page.locator('.bench-dock__count');
  console.log('  count survived the glance:', (await c.count()) > 0 ? (await c.innerText()).replace(/\s+/g, ' ') : '(box finished)');
}

await page.screenshot({ path: `${OUT}/e2e-07-final.png` });
await browser.close();
console.log('\nDONE');
