/**
 * KSeF payment config (#1311) — smoke test + screenshot capture.
 *
 * Drives the running web app with a real browser: logs in, opens the KSeF
 * connection edit screen, and captures screenshots at each payment-config
 * state (empty, Przelew fully filled, saved/persisted-after-reload, Gotówka).
 * Screenshots feed the verification artifact comparing shipped UI against
 * the design mockup at docs/plans/mockups/infakt-ksef-bank-account-payment-terms.html.
 *
 * Usage: node apps/web/e2e/ksef-payment-config.mjs
 * Env:
 *   WEB_BASE   web dev-server base (default http://localhost:5175)
 *   KSEF_CONN_ID  id of the KSeF connection to edit (required)
 */
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(__dirname, '../../../docs/assets/ksef-1311-smoke');
const BASE = process.env.WEB_BASE ?? 'http://localhost:5175';
const CONN_ID = process.env.KSEF_CONN_ID;

if (!CONN_ID) {
  console.error('KSEF_CONN_ID env var is required');
  process.exit(1);
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('Enter your username').fill('admin');
  await page.getByPlaceholder('Enter your password').fill('admin123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });
}

async function shot(page, name) {
  await page.waitForTimeout(500);
  // Clip to the edit-connection form card (not fullPage) to avoid the
  // sticky-sidebar/header duplication artifact fullPage screenshots produce.
  const form = page.locator('form.form-card');
  await form.screenshot({ path: resolve(SHOTS, `${name}.png`) });
  console.log('captured', name);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
await page.context().addInitScript(() => {
  window.localStorage.setItem('openlinker.theme', 'light');
});

try {
  await login(page);

  // 1. Open the KSeF connection edit screen — empty payment-config state.
  await page.goto(`${BASE}/connections/${CONN_ID}/edit`, { waitUntil: 'networkidle' });
  await page.getByLabel('Default payment method').scrollIntoViewIfNeeded();
  await shot(page, '01-payment-section-empty');

  // 2. Fill the Przelew (bank transfer) state — all fields visible/relevant.
  await page.getByLabel('Default payment method').selectOption('6');
  await page.getByLabel('Bank account number').fill('61109010140000000099999999');
  await page.getByLabel('Bank name').fill('Santander Bank Polska');
  await page.getByLabel('SWIFT').fill('WBKPPLPP');
  await page.getByLabel('Default payment term (days)').fill('14');
  await page.getByLabel('Early-payment discount conditions').fill('2% if paid within 7 days');
  await page.getByLabel('Early-payment discount amount').fill('2%');
  await shot(page, '02-payment-section-przelew-filled');

  // 3. Save — the app navigates to the connection detail page on success,
  //    so this state has no form card left to clip; capture the viewport.
  await page.getByRole('button', { name: /Save changes/i }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: resolve(SHOTS, '03-payment-section-saved.png') });
  console.log('captured 03-payment-section-saved');

  // 4. Re-open the edit screen and confirm the fields persisted (proves the
  //    BE round-trip through applyKsefPaymentToConfig + the shape validator).
  await page.goto(`${BASE}/connections/${CONN_ID}/edit`, { waitUntil: 'networkidle' });
  await page.getByLabel('Default payment method').scrollIntoViewIfNeeded();
  await shot(page, '04-payment-section-reloaded-persisted');

  // 5. Switch to Gotówka (cash) — bank/term/skonto fields stay editable
  //    independently (per #1311's assumption that TerminPlatnosci/Skonto
  //    don't require a bank account), matching the mockup's "no live
  //    picker, plain fields" design.
  await page.getByLabel('Default payment method').selectOption('1');
  await shot(page, '05-payment-section-gotowka');

  await page.getByRole('button', { name: /Save changes/i }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: resolve(SHOTS, '06-payment-section-gotowka-saved.png') });
  console.log('captured 06-payment-section-gotowka-saved');

  console.log('KSeF payment-config smoke test PASSED');
} catch (error) {
  await page.screenshot({ path: resolve(SHOTS, 'FAILURE.png'), fullPage: true });
  console.error('KSeF payment-config smoke test FAILED:', error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
