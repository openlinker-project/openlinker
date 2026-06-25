/**
 * Subiekt setup-guide screenshot capture — connection wizard.
 *
 * Drives the running web app (:4173) with a real browser, logs in as the
 * bootstrap admin, and captures a screenshot at EACH step of the Subiekt
 * guided connection wizard (#1199) into docs/assets/subiekt/ (used by
 * docs/integrations/subiekt/setup-guide.md). Captures every meaningful click
 * (exhaustiveness mandate) — empty form, each field filled, created, tested.
 * Run with the dev stack + API + web up, and the Subiekt bridge reachable.
 *
 * Usage: node apps/web/e2e/subiekt-walkthrough.mjs
 * Env:
 *   WEB_BASE            web preview base (default http://localhost:4173)
 *   SUBIEKT_BRIDGE_URL  bridge URL to type into the wizard (default https://172.26.96.1:5005)
 *   SUBIEKT_BRIDGE_TOKEN bearer token to type (optional; blank = unauthenticated bridge)
 *   SUBIEKT_CONN_NAME   connection name (default "My Subiekt")
 */
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(__dirname, '../../../docs/assets/subiekt');
const BASE = process.env.WEB_BASE ?? 'http://localhost:4173';
const BRIDGE_URL = process.env.SUBIEKT_BRIDGE_URL ?? 'https://172.26.96.1:5005';
const BRIDGE_TOKEN = process.env.SUBIEKT_BRIDGE_TOKEN ?? '';
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

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  await login(page);
  await shot(page, '00-dashboard');

  // 1. Connections list (starting point).
  await page.goto(`${BASE}/connections`, { waitUntil: 'networkidle' });
  await shot(page, '01-connections-list');

  // 2. Add-connection platform picker — the Subiekt setupCard ("Subiekt nexo").
  await page.goto(`${BASE}/connections/new`, { waitUntil: 'networkidle' });
  await shot(page, '02-platform-picker');

  // 3. Open the guided Subiekt wizard (empty form).
  await page.goto(`${BASE}/connections/new/subiekt`, { waitUntil: 'networkidle' });
  await shot(page, '03-subiekt-wizard-empty');

  // 4. Fill the wizard, field by field.
  await page.getByLabel('Connection name').fill(CONN_NAME);
  await shot(page, '04-wizard-name');

  await page.getByLabel('Bridge URL').fill(BRIDGE_URL);
  await shot(page, '05-wizard-bridge-url');

  if (BRIDGE_TOKEN) {
    await page.getByLabel('Bridge token (optional)').fill(BRIDGE_TOKEN);
    await shot(page, '06-wizard-token-filled');
  }

  // 5. Submit — "Connect Subiekt".
  await page.getByRole('button', { name: /Connect Subiekt/i }).click();
  await page.waitForTimeout(1500);
  await shot(page, '07-wizard-created');

  // 6. Test connection — probes the bridge /health.
  const testBtn = page.getByRole('button', { name: /Test connection/i }).first();
  if (await testBtn.count()) {
    await testBtn.click();
    await page.waitForTimeout(2000);
    await shot(page, '08-connection-test-ok');
  }

  // 7. Connection detail (capabilities, trigger model, edit surface #759).
  await page.goto(`${BASE}/connections`, { waitUntil: 'networkidle' });
  await shot(page, '09-connections-list-with-subiekt');
  const row = page.getByText(CONN_NAME, { exact: false }).first();
  if (await row.count()) {
    await row.click();
    await page.waitForTimeout(1200);
    await shot(page, '10-subiekt-connection-detail');
  }

  console.log('DONE');
} catch (err) {
  console.error('WALKTHROUGH_ERROR', err.message);
  await page.screenshot({ path: resolve(SHOTS, 'error-walkthrough.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
