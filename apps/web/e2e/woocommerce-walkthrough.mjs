/**
 * WooCommerce master-shop setup-guide screenshot capture.
 *
 * Drives the running web app (:4173) with a real browser, forces light theme
 * (the previous set of screenshots was captured in dark mode by mistake),
 * logs in as the bootstrap admin, walks the WooCommerce connection wizard,
 * triggers the product/inventory sync, and captures the 9 screens referenced
 * from libs/integrations/woocommerce/docs/master-shop-setup-guide.md into
 * libs/integrations/woocommerce/docs/assets/{1,2,2a,3,4,5,6,7,8}.png.
 *
 * Prereqs: dev stack + api/worker/web up, WooCommerce seeded
 * (pnpm dev:stack:seed-woocommerce), a local HTTPS terminator in front of
 * WooCommerce (see docs/master-shop-setup-guide.md § 4 callout).
 *
 * Usage:
 *   WC_SITE_URL=https://localhost:8443 \
 *   WC_CONSUMER_KEY=ck_... WC_CONSUMER_SECRET=cs_... \
 *   node apps/web/e2e/woocommerce-walkthrough.mjs
 */
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { annotate, clearAnnotations } from './annotate.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(__dirname, '../../../libs/integrations/woocommerce/docs/assets');
const BASE = process.env.WEB_BASE ?? 'http://localhost:4173';
const API_BASE = process.env.API_BASE ?? 'http://localhost:3000';
const SITE_URL = process.env.WC_SITE_URL ?? 'https://localhost:8443';
const CONSUMER_KEY = process.env.WC_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.WC_CONSUMER_SECRET;
const CONN_NAME = process.env.WC_CONN_NAME ?? 'WooCommerce Store';

if (!CONSUMER_KEY || !CONSUMER_SECRET) {
  console.error('WC_CONSUMER_KEY / WC_CONSUMER_SECRET env vars are required.');
  process.exit(2);
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('Enter your username').fill('admin');
  await page.getByPlaceholder('Enter your password').fill('admin123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });
}

async function shot(page, name) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: resolve(SHOTS, `${name}.png`), fullPage: true });
  console.log('captured', name);
  await clearAnnotations(page);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
// Force light theme regardless of host prefers-color-scheme — this is the
// bug being fixed: the previous capture ran under a dark-mode default.
await context.addInitScript(() => {
  window.localStorage.setItem('openlinker.theme', 'light');
});
const page = await context.newPage();

try {
  await login(page);

  // 1. Connections list — box the "New connection" button.
  await page.goto(`${BASE}/connections`, { waitUntil: 'networkidle' });
  await annotate(page, [{ locator: page.getByRole('link', { name: 'New connection' }).first() }]);
  await shot(page, '1');

  // 2. Platform picker — box the WooCommerce card.
  await page.goto(`${BASE}/connections/new`, { waitUntil: 'networkidle' });
  await annotate(page, [
    { locator: page.locator('.platform-picker__card').filter({ hasText: 'WooCommerce' }) },
  ]);
  await shot(page, '2');

  // 3. Open the WooCommerce wizard, fill it, box every field before submit.
  await page.goto(`${BASE}/connections/new/woocommerce`, { waitUntil: 'networkidle' });
  await page.getByLabel('Connection name').fill(CONN_NAME);
  await page.getByLabel('Site URL').fill(SITE_URL);
  await page.getByLabel('Consumer key').fill(CONSUMER_KEY);
  await page.getByLabel('Consumer secret').fill(CONSUMER_SECRET);
  await annotate(page, [
    { locator: page.getByLabel('Connection name') },
    { locator: page.getByLabel('Site URL') },
    { locator: page.getByLabel('Consumer key') },
    { locator: page.getByLabel('Consumer secret') },
    { locator: page.getByRole('button', { name: /Connect WooCommerce/i }) },
  ]);
  await shot(page, '2a');

  await page.getByRole('button', { name: /Connect WooCommerce/i }).click();
  await page.waitForURL((u) => u.pathname === '/connections', { timeout: 15000 });
  await page.waitForTimeout(1000);

  // Open the new connection's detail page.
  const row = page.getByText(CONN_NAME, { exact: false }).first();
  await row.click();
  await page.waitForURL(/\/connections\/[^/]+$/, { timeout: 15000 });
  const connectionId = page.url().split('/connections/')[1].split(/[/?]/)[0];
  console.log('connection id:', connectionId);

  // 3. Overview tab — Active status + capability pills, boxed.
  await page.goto(`${BASE}/connections/${connectionId}`, { waitUntil: 'networkidle' });
  await annotate(page, [{ locator: page.locator('.capability-list__pills') }]);
  await shot(page, '3');

  // 4. Actions tab — box the "Test connection" button.
  await page.goto(`${BASE}/connections/${connectionId}?tab=actions`, { waitUntil: 'networkidle' });
  await annotate(page, [
    { locator: page.getByRole('button', { name: 'Test connection' }).first() },
  ]);
  await shot(page, '4');
  await page.getByRole('button', { name: 'Test connection' }).first().click();
  await page.waitForTimeout(1500);

  // Trigger the product + inventory sync directly via the API (deterministic,
  // avoids depending on the Trigger-sync dialog's exact markup) so Products /
  // Inventory / Orders have data by the time we screenshot them. The web app
  // keeps its JWT in memory only (#710), so log in again from Node directly
  // rather than trying to read it out of the page.
  const loginRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const { access_token: token } = await loginRes.json();
  async function enqueue(jobType) {
    const res = await fetch(`${API_BASE}/sync/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        connectionId,
        jobType,
        idempotencyKey: `wc-screenshot-capture:${connectionId}:${jobType}`,
      }),
    });
    console.log(jobType, res.status);
  }
  if (token) {
    await enqueue('master.product.syncAll');
    await page.waitForTimeout(6000);
    await enqueue('master.inventory.syncAll');
    await page.waitForTimeout(6000);
  } else {
    console.warn('No auth token found in localStorage — skipping direct sync trigger.');
  }

  // 5. Products list.
  await page.goto(`${BASE}/products`, { waitUntil: 'networkidle' });
  await shot(page, '5');

  // 6. Inventory list.
  await page.goto(`${BASE}/inventory`, { waitUntil: 'networkidle' });
  await shot(page, '6');

  // 7. Inventory item detail.
  const invRow = page.locator('table tbody tr').first();
  if (await invRow.count()) {
    await invRow.click();
    await page.waitForTimeout(1000);
    await shot(page, '7');
  } else {
    console.warn('No inventory rows found — skipping 7 (item detail).');
  }

  // 8. Orders list (the two seeded WooCommerce orders, once ingested).
  await page.goto(`${BASE}/orders`, { waitUntil: 'networkidle' });
  await shot(page, '8');

  console.log('DONE');
} catch (err) {
  console.error('WALKTHROUGH_ERROR', err.message);
  await page.screenshot({ path: resolve(SHOTS, 'error-walkthrough.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
