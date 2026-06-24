/**
 * Erli setup-guide screenshot capture.
 *
 * Drives the running web app (:4173) with a real browser, logs in as the
 * bootstrap admin, and captures a screenshot at each step of the Erli setup
 * flow into docs/assets/erli/ (used by docs/integrations/erli/setup-guide.md).
 * Run with the dev stack + API + web up.
 *
 * Usage: node apps/web/e2e/erli-walkthrough.mjs [step]
 *   step (optional): connection | offer | all   (default: connection)
 */
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(__dirname, '../../../docs/assets/erli');
const BASE = process.env.WEB_BASE ?? 'http://localhost:4173';
const ERLI_CONNECTION_ID = process.env.ERLI_CONNECTION_ID ?? '19d837f0-1b7c-448b-b381-8c8c9bc4ba07';

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

const step = process.argv[2] ?? 'connection';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  await login(page);
  await shot(page, '00-dashboard');

  if (step === 'connection' || step === 'all') {
    await page.goto(`${BASE}/connections`, { waitUntil: 'networkidle' });
    await shot(page, '01-connections-list');

    await page.goto(`${BASE}/connections/new`, { waitUntil: 'networkidle' });
    await shot(page, '02-platform-picker');

    await page.goto(`${BASE}/connections/new/erli`, { waitUntil: 'networkidle' });
    await shot(page, '03-erli-setup-form');

    await page.goto(`${BASE}/connections/${ERLI_CONNECTION_ID}`, { waitUntil: 'networkidle' });
    await shot(page, '04-erli-connection-detail');
  }

  if (step === 'offer' || step === 'all') {
    await page.goto(`${BASE}/listings`, { waitUntil: 'networkidle' });
    await shot(page, '05-listings');
    await page.getByRole('button', { name: 'Create offer' }).first().click();
    await page.waitForTimeout(1200);
    await shot(page, '06-offer-connection-picker');
    // Pick the Erli connection via the select dropdown, then Continue.
    const combo = page.getByRole('combobox').first();
    if (await combo.count()) {
      try {
        await combo.selectOption({ label: /My erli/i });
      } catch {
        await combo.selectOption({ index: 1 });
      }
    }
    const cont = page.getByRole('button', { name: 'Continue' }).first();
    if (await cont.count()) {
      await cont.click();
      await page.waitForTimeout(1500);
    }
    await shot(page, '07-wizard-variant-step');
    // Search + pick first variant.
    const search = page.getByPlaceholder('e.g. T-shirt, SKU-123, 5901234567890');
    if (await search.count()) {
      await search.fill('ring');
      await page.waitForTimeout(1500);
      await shot(page, '08-wizard-variant-results');
      // Pick the first variant result, advance to the details step.
      const row = page.getByRole('button', { name: /Resin Ring/i }).first();
      if (await row.count()) {
        await row.click();
        await page.waitForTimeout(800);
        // Capture the picked-variant state (shows the image-required blocker
        // when the master product has no public https image).
        await shot(page, '09-wizard-variant-picked');
        const next = page.getByRole('button', { name: /Next/i }).first();
        if ((await next.count()) && (await next.isEnabled())) {
          await next.click();
          await page.waitForTimeout(1200);
          await shot(page, '10-wizard-offer-details');
        }
      }
    }
  }

  if (step === 'orders' || step === 'all') {
    await page.goto(`${BASE}/orders`, { waitUntil: 'networkidle' });
    await shot(page, '11-orders-list');
    // Open the first order row (the Erli order is most recent).
    const firstRow = page.locator('table tbody tr, [role="row"]').first();
    if (await firstRow.count()) {
      await firstRow.click();
      await page.waitForTimeout(1200);
      await shot(page, '12-order-detail');
    }
  }

  console.log('DONE');
} catch (err) {
  console.error('WALKTHROUGH_ERROR', err.message);
  await page.screenshot({ path: resolve(SHOTS, 'error.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
