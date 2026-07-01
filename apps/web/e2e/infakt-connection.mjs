/**
 * inFakt setup-guide screenshot capture — connection walkthrough.
 *
 * Drives the running web app (:4173): opens /connections/new, selects the
 * inFakt card, fills out the guided setup form with the real sandbox API
 * key, submits, and runs "Test connection". Captures docs/assets/infakt/.
 *
 * Presentation requirement (these screenshots are reused verbatim in the
 * operator-facing setup guide): the API-key input stays `type="password"`
 * throughout — this script never switches it to reveal the raw key, and
 * never logs the key to stdout. Use a realistic connection name, not
 * placeholder junk.
 *
 * Usage: node apps/web/e2e/infakt-connection.mjs
 * Env:
 *   WEB_BASE                web preview base (default http://localhost:4173)
 *   INFAKT_SANDBOX_API_KEY  required — real inFakt sandbox API key
 *   INFAKT_CONN_NAME        connection name (default "inFakt Sandbox")
 */
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(__dirname, '../../../docs/assets/infakt');
const BASE = process.env.WEB_BASE ?? 'http://localhost:4173';
const API_KEY = process.env.INFAKT_SANDBOX_API_KEY ?? '';
const CONN_NAME = process.env.INFAKT_CONN_NAME ?? 'inFakt Sandbox';

if (!API_KEY) {
  console.error('INFAKT_CONNECTION_ERROR: INFAKT_SANDBOX_API_KEY is required (not committed, not logged).');
  process.exit(1);
}

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

  // 1. Platform picker — inFakt card visible.
  await page.goto(`${BASE}/connections/new`, { waitUntil: 'networkidle' });
  await shot(page, '00-platform-picker');

  // 2. Guided setup form (empty).
  const infaktCard = page.locator('.platform-picker__card', { hasText: 'inFakt' });
  await infaktCard.click();
  await page.waitForURL(/\/connections\/new\/infakt/, { timeout: 10000 });
  await shot(page, '01-infakt-wizard-empty');

  // 3. Filled form — realistic name, real sandbox key (masked on screen).
  await page.getByLabel('Connection name').fill(CONN_NAME);
  await page.getByLabel('API key').fill(API_KEY);
  await shot(page, '02-infakt-wizard-filled');

  // 4. Submit — connection created.
  await page.getByRole('button', { name: 'Connect inFakt' }).click();
  await page.waitForTimeout(1500);
  await shot(page, '03-infakt-connection-created');

  // 5. Test connection.
  const testBtn = page.getByRole('button', { name: 'Test connection' });
  if (await testBtn.count()) {
    await testBtn.click();
    await page.waitForTimeout(3000);
    await shot(page, '04-infakt-connection-test-ok');
  }

  // 6. Connections list — the new inFakt connection visible.
  await page.goto(`${BASE}/connections`, { waitUntil: 'networkidle' });
  await shot(page, '05-connections-list-with-infakt');

  console.log('DONE');
} catch (err) {
  console.error('INFAKT_CONNECTION_ERROR', err.message);
  await page.screenshot({ path: resolve(SHOTS, 'error-connection.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
