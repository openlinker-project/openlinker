/**
 * Connection enable/disable round-trip capture (#1940).
 *
 * Drives the real UI through the full loop on a live stack: disable an active
 * connection, prove the recovery controls appear, enable it again, and prove the
 * connection is back to `active`. Produces the screenshots that evidence the fix.
 *
 * Like every script in this folder it is a documentation-capture script, not an
 * automated test — no runner executes it. It does, however, fail loudly: each
 * step asserts the control it expects before shooting, so a green run means the
 * flow genuinely worked rather than that a screenshot was taken of a broken page.
 *
 * Usage:
 *   WEB_BASE=http://localhost:8090 API_BASE=http://localhost:3000 \
 *   CONNECTION_ID=<uuid> node apps/web/e2e/connection-enable.mjs
 *
 * Env:
 *   WEB_BASE          web app base URL (default http://localhost:4173)
 *   API_BASE          API base URL, used only to restore state on failure
 *   CONNECTION_ID     connection to drive; defaults to the first active one found
 *   OL_ADMIN_USERNAME / OL_ADMIN_PASSWORD   admin login (default admin / admin)
 *   OUT_DIR           screenshot output directory (default ./e2e-out)
 *   HEADED            set to 1 to watch the run
 */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { annotate, clearAnnotations } from './annotate.mjs';

const WEB_BASE = process.env.WEB_BASE ?? 'http://localhost:4173';
const USERNAME = process.env.OL_ADMIN_USERNAME ?? 'admin';
const PASSWORD = process.env.OL_ADMIN_PASSWORD ?? 'admin';
const OUT_DIR = process.env.OUT_DIR ?? 'e2e-out';
const CONNECTION_ID = process.env.CONNECTION_ID ?? '';

let shotIndex = 0;
async function shot(page, name) {
  shotIndex += 1;
  const path = `${OUT_DIR}/${String(shotIndex).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path, fullPage: true });
  console.log(`  captured ${path}`);
  return path;
}

async function login(page) {
  await page.goto(`${WEB_BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel(/username/i).fill(USERNAME);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
}

/** Resolve a connection to drive: the explicit id, else the first active row. */
async function resolveConnectionId(page) {
  if (CONNECTION_ID) return CONNECTION_ID;

  await page.goto(`${WEB_BASE}/connections?status=active`, { waitUntil: 'domcontentloaded' });
  const firstRow = page.locator('a[href^="/connections/"]').first();
  await firstRow.waitFor({ timeout: 15_000 });
  const href = await firstRow.getAttribute('href');
  const id = href?.split('/').filter(Boolean)[1];
  if (!id) throw new Error('No active connection found — pass CONNECTION_ID explicitly.');
  return id;
}

/**
 * `.status-badge` is `text-transform: uppercase`, and `innerText` returns the
 * *rendered* text — so the DOM value "active" reads back as "ACTIVE". Normalise
 * rather than comparing against the styled casing.
 */
async function statusBadgeText(page) {
  const text = await page.locator('.page-summary .status-badge').first().innerText();
  return text.trim().toLowerCase();
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: process.env.HEADED !== '1' });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'dark',
  });
  const page = await context.newPage();

  try {
    await login(page);
    const connectionId = await resolveConnectionId(page);
    const detailUrl = `${WEB_BASE}/connections/${connectionId}`;
    console.log(`Driving connection ${connectionId}`);

    // ── 1. Starting point: an active connection, Actions tab ──────────────
    await page.goto(`${detailUrl}?tab=actions`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Disable' }).waitFor({ timeout: 15_000 });
    if ((await statusBadgeText(page)) !== 'active') {
      throw new Error('Connection is not active at the start — cannot drive the round trip.');
    }
    await annotate(page, [
      { locator: page.getByRole('button', { name: 'Disable' }), shape: 'ellipse', arrow: true },
    ]);
    await shot(page, 'active-actions-tab');
    await clearAnnotations(page);

    // ── 2. Disable it ─────────────────────────────────────────────────────
    await page.getByRole('button', { name: 'Disable' }).click();
    await page.getByRole('button', { name: 'Disable connection' }).click();
    await page.waitForSelector('text=Connection disabled', { timeout: 15_000 });
    await shot(page, 'disable-confirmed');

    // ── 3. The fix, part 1: the Actions tab now offers Enable ─────────────
    await page.reload({ waitUntil: 'domcontentloaded' });
    const enableRowButton = page.getByRole('button', { name: 'Enable', exact: true });
    await enableRowButton.waitFor({ timeout: 15_000 });
    if ((await statusBadgeText(page)) !== 'disabled') {
      throw new Error('Status badge did not flip to disabled.');
    }
    await annotate(page, [{ locator: enableRowButton, shape: 'ellipse', arrow: true }]);
    await shot(page, 'disabled-actions-tab-offers-enable');
    await clearAnnotations(page);

    // ── 4. The fix, part 2: the sync-paused banner on the detail page ─────
    await page.goto(detailUrl, { waitUntil: 'domcontentloaded' });
    const banner = page.locator('.alert', { hasText: 'Syncing is paused' });
    await banner.waitFor({ timeout: 15_000 });
    await annotate(page, [{ locator: banner }]);
    await shot(page, 'disabled-sync-paused-banner');
    await clearAnnotations(page);

    // ── 5. Enable from the banner, and prove it took ──────────────────────
    await page.getByRole('button', { name: 'Enable connection' }).click();
    await page.waitForSelector('text=Connection enabled', { timeout: 15_000 });
    await shot(page, 'enable-confirmed-toast');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.page-summary .status-badge', { timeout: 15_000 });
    const finalStatus = await statusBadgeText(page);
    if (finalStatus !== 'active') {
      throw new Error(`Expected status active after enable, got "${finalStatus}".`);
    }
    if (await page.locator('.alert', { hasText: 'Syncing is paused' }).count()) {
      throw new Error('Sync-paused banner still present after enabling.');
    }
    await annotate(page, [
      { locator: page.locator('.page-summary .status-badge').first(), padding: 6 },
    ]);
    await shot(page, 'active-again-after-enable');
    await clearAnnotations(page);

    // ── 6. Actions tab is whole again ─────────────────────────────────────
    await page.goto(`${detailUrl}?tab=actions`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Disable' }).waitFor({ timeout: 15_000 });
    if (await page.getByRole('button', { name: 'Enable', exact: true }).count()) {
      throw new Error('Enable row is still rendered for an active connection.');
    }
    await shot(page, 'active-actions-tab-restored');

    console.log('\nRound trip complete: active -> disabled -> active, all from the UI.');
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
