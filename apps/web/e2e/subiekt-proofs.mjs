/**
 * Subiekt setup-guide screenshot capture — auto-trigger + idempotency proofs.
 *
 * Captures the UI evidence for the worker-driven paths (#1120 auto-issue
 * trigger, #1212 exactly-once) into docs/assets/subiekt/:
 *   - the /invoices list reflecting an auto-issued document (trigger = "Auto on
 *     order paid" on the Subiekt connection, fired by the worker);
 *   - re-Issue/Retry on an already-issued order returning the SAME document with
 *     no duplicate (idempotency key invoice:{connectionId}:{orderId}).
 *
 * The auto-issue itself is worker-driven (set the trigger model + mark an order
 * paid out of band); this script captures the resulting OL UI state. Run after
 * subiekt-invoice.mjs.
 *
 * Usage: node apps/web/e2e/subiekt-proofs.mjs
 * Env:
 *   WEB_BASE       web preview base (default http://localhost:4173)
 *   ORDER_AUTO_ID  OL order id auto-issued by the trigger (optional)
 *   ORDER_B2B_ID   OL order to re-issue for the idempotency proof (optional)
 */
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(__dirname, '../../../docs/assets/subiekt');
const BASE = process.env.WEB_BASE ?? 'http://localhost:4173';
const ORDER_AUTO_ID = process.env.ORDER_AUTO_ID ?? '';
const ORDER_B2B_ID = process.env.ORDER_B2B_ID ?? '';

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('Enter your username').fill('admin');
  await page.getByPlaceholder('Enter your password').fill('admin');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });
}

async function shot(page, name) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: resolve(SHOTS, `${name}.png`), fullPage: true });
  console.log('captured', name);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  await login(page);

  // 1. Auto-issued document on the invoices list (worker trigger #1120).
  await page.goto(`${BASE}/invoices`, { waitUntil: 'networkidle' });
  await shot(page, '30-invoices-list-auto-issued');

  if (ORDER_AUTO_ID) {
    await page.goto(`${BASE}/orders/${ORDER_AUTO_ID}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await shot(page, '31-order-auto-issued-panel');
  }

  // 2. Idempotency proof: re-Issue/Retry an already-issued order -> same doc.
  if (ORDER_B2B_ID) {
    await page.goto(`${BASE}/orders/${ORDER_B2B_ID}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await shot(page, '32-order-already-issued');
    const retry = page.getByRole('button', { name: /Retry|Issue invoice/i }).first();
    if (await retry.count()) {
      await retry.click();
      await page.waitForTimeout(5000);
      await shot(page, '33-idempotent-same-document');
    }
  }

  console.log('DONE');
} catch (err) {
  console.error('PROOFS_ERROR', err.message);
  await page.screenshot({ path: resolve(SHOTS, 'error-proofs.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
