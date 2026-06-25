/**
 * Subiekt setup-guide screenshot capture — issue invoices from an order.
 *
 * Drives the running web app (:4173): opens a real ingested order, issues an
 * invoice through the order-detail Invoice panel (#757), and captures the
 * before/after states + the /invoices list (#758) into docs/assets/subiekt/.
 * Captures both document types: B2B faktura (buyer with NIP) and B2C paragon.
 *
 * The actual document is created end-to-end: OL -> subiekt adapter -> bridge
 * -> Subiekt nexo. This script only drives + screenshots the OL browser side;
 * the Subiekt-app proof shots are captured on Windows.
 *
 * Usage: node apps/web/e2e/subiekt-invoice.mjs [b2b|b2c|all]   (default all)
 * Env:
 *   WEB_BASE        web preview base (default http://localhost:4173)
 *   ORDER_B2B_ID    OL order id with a NIP buyer (faktura)   — optional, else first order row
 *   ORDER_B2C_ID    OL order id without NIP (paragon)        — optional
 *   SUBIEKT_CONN_NAME  connection label to pick when >1 invoicing connection
 */
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(__dirname, '../../../docs/assets/subiekt');
const BASE = process.env.WEB_BASE ?? 'http://localhost:4173';
const ORDER_B2B_ID = process.env.ORDER_B2B_ID ?? '';
const ORDER_B2C_ID = process.env.ORDER_B2C_ID ?? '';
const CONN_NAME = process.env.SUBIEKT_CONN_NAME ?? 'My Subiekt';

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

async function openOrder(page, orderId, prefix) {
  if (orderId) {
    await page.goto(`${BASE}/orders/${orderId}`, { waitUntil: 'networkidle' });
  } else {
    await page.goto(`${BASE}/orders`, { waitUntil: 'networkidle' });
    await shot(page, `${prefix}-orders-list`);
    const firstRow = page.locator('table tbody tr, [role="row"]').first();
    if (await firstRow.count()) {
      await firstRow.click();
      await page.waitForURL(/\/orders\//, { timeout: 10000 }).catch(() => {});
    }
  }
  await page.waitForTimeout(1200);
}

async function pickConnectionIfNeeded(page) {
  // The panel renders a connection picker (aria-label "Invoicing connection")
  // when >1 invoicing connection is active.
  const picker = page.getByLabel(/Invoicing connection/i).first();
  if (await picker.count()) {
    try {
      await picker.selectOption({ label: new RegExp(CONN_NAME, 'i') });
    } catch {
      await picker.selectOption({ index: 1 }).catch(() => {});
    }
    await page.waitForTimeout(800);
  }
}

async function issueFlow(page, orderId, prefix) {
  await openOrder(page, orderId, prefix);
  await shot(page, `${prefix}-order-detail-not-issued`);
  await pickConnectionIfNeeded(page);
  await shot(page, `${prefix}-invoice-panel-ready`);

  const issueBtn = page.getByRole('button', { name: /Issue invoice/i }).first();
  if (await issueBtn.count()) {
    await issueBtn.click();
    // Wait for the round-trip OL -> bridge -> Subiekt.
    await page.waitForTimeout(6000);
    await shot(page, `${prefix}-invoice-issued`);
  } else {
    console.log(`${prefix}: Issue button not present (already issued?)`);
    await shot(page, `${prefix}-invoice-panel-state`);
  }
}

const mode = process.argv[2] ?? 'all';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  await login(page);

  if (mode === 'b2b' || mode === 'all') {
    await issueFlow(page, ORDER_B2B_ID, '20-b2b');
  }
  if (mode === 'b2c' || mode === 'all') {
    await issueFlow(page, ORDER_B2C_ID, '21-b2c');
  }

  // The /invoices list (#758) with filters — both documents visible.
  await page.goto(`${BASE}/invoices`, { waitUntil: 'networkidle' });
  await shot(page, '22-invoices-list');

  console.log('DONE');
} catch (err) {
  console.error('INVOICE_ERROR', err.message);
  await page.screenshot({ path: resolve(SHOTS, 'error-invoice.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
