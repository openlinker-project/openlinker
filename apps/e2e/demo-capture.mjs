/**
 * Client-ready capture of the pack bench on a REAL Allegro order, as the new
 * packer. Phone, tablet and desktop.
 *
 * The camera's DECODER is stubbed (headless Chromium ships none); the camera
 * PATH is real - fake device, real getUserMedia, real stream, real read into
 * the same handler a wedge scanner uses.
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:38090';
const OUT = '/tmp/apw-screenshots';
const PACKER = { user: 'anna.pakowska', pass: 'Pakowanie!2026' };

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});

async function signedInPage(size, mobile) {
  const ctx = await browser.newContext({
    viewport: size,
    hasTouch: mobile,
    isMobile: mobile,
    permissions: ['camera'],
  });
  await ctx.addInitScript(() => {
    window.__nextBarcode = null;
    class BarcodeDetector {
      static getSupportedFormats() {
        return Promise.resolve(['ean_13', 'code_128', 'qr_code']);
      }
      detect() {
        const v = window.__nextBarcode;
        return Promise.resolve(v === null ? [] : [{ rawValue: v }]);
      }
    }
    window.BarcodeDetector = BarcodeDetector;
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('Username or email').fill(PACKER.user);
  await page.getByPlaceholder('Enter your password').fill(PACKER.pass);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(1800);
  return { ctx, page };
}

async function openFirstParcel(page) {
  await page.goto(`${BASE}/bench`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
  const open = page.getByRole('button', { name: 'Open parcel' });
  if ((await open.count()) === 0) return false;
  await open.first().click();
  await page.waitForTimeout(2200);
  return true;
}

// ── PHONE ─────────────────────────────────────────────────────────────────
{
  const { ctx, page } = await signedInPage({ width: 390, height: 844 }, true);
  await page.goto(`${BASE}/bench`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${OUT}/demo-phone-1-list.png` });

  await openFirstParcel(page);
  await page.screenshot({ path: `${OUT}/demo-phone-2-box.png` });

  // Switcher
  await page.locator('.bench-dock__handle').click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/demo-phone-3-switcher.png` });
  await page.locator('.bench-dock__handle').click();
  await page.waitForTimeout(400);

  // Camera, held OPEN: no code is being read yet, so the viewfinder stays.
  const cam = page.getByRole('button', { name: 'Scan with camera' });
  if ((await cam.count()) > 0) {
    await cam.click();
    await page.waitForTimeout(2200);
    await page.screenshot({ path: `${OUT}/demo-phone-4-camera.png` });
    console.log('viewfinder held open:', (await page.locator('[data-testid="bench-camera"]').count()) > 0);

    // Now let it read the item's own code.
    const codes = (await page.locator('.bench-dock__strip-codes').innerText()).replace(/\s+/g, ' ');
    const code =
      (codes.match(/\b\d{8,14}\b/) ?? [])[0] ?? (codes.match(/SKU\s+([^\s·]+)/) ?? [])[1] ?? null;
    console.log('reading:', code);
    await page.evaluate((c) => {
      window.__nextBarcode = c;
    }, code);
    await page.waitForTimeout(2000);
    await page.evaluate(() => {
      window.__nextBarcode = null;
    });
    await page.waitForTimeout(1200);
  }
  await page.screenshot({ path: `${OUT}/demo-phone-5-packed.png`, fullPage: true });
  const closed = await page.locator('[data-testid="bench-parcel-closed"]').count();
  console.log('phone: box closed by the scan:', closed > 0);
  await ctx.close();
}

// ── TABLET ────────────────────────────────────────────────────────────────
{
  const { ctx, page } = await signedInPage({ width: 834, height: 1112 }, true);
  const ok = await openFirstParcel(page);
  console.log('tablet: opened a box:', ok);
  await page.screenshot({ path: `${OUT}/demo-tablet-1-box.png` });
  await ctx.close();
}

// ── DESKTOP ───────────────────────────────────────────────────────────────
{
  const { ctx, page } = await signedInPage({ width: 1440, height: 1000 }, false);
  const ok = await openFirstParcel(page);
  console.log('desktop: opened a box:', ok);
  await page.screenshot({ path: `${OUT}/demo-desktop-1-box.png` });
  await ctx.close();
}

await browser.close();
console.log('DONE');
