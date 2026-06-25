/**
 * Erli setup-guide captures (cropped).
 *
 * Drives the running web app (:4173) as the bootstrap admin and captures tight,
 * cropped screenshots of the Erli flow for docs/integrations/erli/setup-guide.md:
 *   20/21 are panel shots (separate script: erli-panel.mjs)
 *   22 — the created Erli offer row in OL Listings (cropped to the row)
 *   23 — the OL inventory value after a PrestaShop stock change (cropped)
 *   24 — the ingested Erli order detail in OL Orders (cropped)
 *
 * Run with the dev stack + API + web up. Uses locator.screenshot() / clip for
 * tight crops instead of full-page shots.
 *
 * Usage: node apps/web/e2e/erli-proofs.mjs
 */
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(__dirname, '../../../docs/assets/erli');
const BASE = process.env.WEB_BASE ?? 'http://localhost:4173';
const VARIANT = 'ol_variant_2dab6f6bd3a542b3b6e86a1bc6696150';
const ERLI_ORDER_ID = process.env.ERLI_ORDER_ID ?? 'ol_order_0b951671b4584d7f97b7866c58665f9c';

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('Enter your username').fill('admin');
  await page.getByPlaceholder('Enter your password').fill('admin');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });
}

/** Crop to a locator if present & visible; otherwise fall back to a clip box. */
async function cropShot(page, name, locator, fallbackClip) {
  await page.waitForTimeout(600);
  try {
    if (locator && (await locator.count())) {
      const el = locator.first();
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await el.screenshot({ path: resolve(SHOTS, `${name}.png`) });
      console.log('captured (locator)', name);
      return;
    }
  } catch (e) {
    console.log('locator crop failed for', name, e.message);
  }
  await page.screenshot({
    path: resolve(SHOTS, `${name}.png`),
    clip: fallbackClip ?? { x: 0, y: 0, width: 1440, height: 480 },
  });
  console.log('captured (clip)', name);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  await login(page);

  // 22 — created Erli offer row in OL Listings (filter to the variant, crop the row).
  await page.goto(`${BASE}/listings`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  // Try to narrow to the Resin Ring offer via the row that mentions it.
  const offerRow = page
    .locator('table tbody tr, [role="row"]')
    .filter({ hasText: /Resin Ring|2dab6f6b/i });
  await cropShot(page, '22-ol-offer-row', offerRow, {
    x: 0,
    y: 120,
    width: 1440,
    height: 420,
  });

  // 23 — OL inventory value after a PS stock change (crop the variant row).
  await page.goto(`${BASE}/inventory`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  // Try a search box first to isolate the variant if one exists.
  const invSearch = page.getByPlaceholder(/search/i).first();
  if (await invSearch.count()) {
    await invSearch.fill('Resin Ring').catch(() => {});
    await page.waitForTimeout(1000);
  }
  // The product has two size variants (qty 33 vs 100) sharing one title — filter
  // strictly by the target variant's (truncated) id so we crop the right row.
  const invRow = page
    .locator('table tbody tr, [role="row"]')
    .filter({ hasText: /2dab6f6b/i });
  await cropShot(page, '23-ol-stock-after-change', invRow, {
    x: 0,
    y: 120,
    width: 1440,
    height: 460,
  });

  // 24 — ingested Erli order detail in OL Orders. Navigate directly to the
  // Erli-sourced order (the orders list is date-sorted and may show a newer
  // PrestaShop order on top).
  await page.goto(`${BASE}/orders/${ERLI_ORDER_ID}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  // Crop to the order header + KPI cards (source = Erli, status, total) — a tight
  // proof rather than the full, very tall detail page.
  await page.screenshot({
    path: resolve(SHOTS, '24-ol-order-detail.png'),
    clip: { x: 0, y: 56, width: 1440, height: 420 },
  });
  console.log('captured (clip) 24-ol-order-detail');

  console.log('DONE');
} catch (err) {
  console.error('PROOFS_ERROR', err.message);
  await page.screenshot({ path: resolve(SHOTS, 'proofs-error.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
