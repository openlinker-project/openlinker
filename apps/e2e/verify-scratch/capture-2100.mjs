/**
 * Screenshot capture for #2100 — scratch, not part of any Playwright project.
 *
 * Drives the four operator surfaces the issue asks for and writes PNGs. Kept in
 * `verify-scratch/` (gitignored) because it is evidence for a PR comment, not a
 * regression test — the assertions live in
 * `tests/invoicing/sales-document-block.spec.ts`.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const WEB = 'http://localhost:5273';
const OUT = '/tmp/claude-1000/-home-nor-projekty-blocky-openlinker-pnpm-10/ba4aa293-a9bc-4dcf-81c6-122542c21a2f/scratchpad/shots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

async function shoot(name, { width, height }, fn) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    storageState: '.auth/admin.json',
  });
  const page = await ctx.newPage();
  await fn(page);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  await ctx.close();
  console.log('captured', name);
}

async function login(page) {
  // storageState may already be valid; only fill the form if it is actually there.
  await page.goto(`${WEB}/orders`);
  await page.waitForLoadState('networkidle').catch(() => {});
  const user = page.getByLabel(/username or email/i);
  if ((await user.count()) > 0) {
    await user.fill('admin');
    await page.getByLabel(/password/i).fill('admin');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 });
  }
}

// 1. The orders list — three causes, three badges, one control row.
await shoot('01-orders-list', { width: 1440, height: 900 }, async (page) => {
  await login(page);
  await page.goto(`${WEB}/orders`);
  await page.locator('.data-table__row').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
});

// 2. The filter chip applied — count matches the rows.
await shoot('02-filter-applied', { width: 1440, height: 900 }, async (page) => {
  await login(page);
  await page.goto(`${WEB}/orders?invoicing=blocked`);
  await page.locator('.data-table__row').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
});

// 3. Order detail — the panel reads the persisted reason and offers the fix.
await shoot('03-detail-panel', { width: 1440, height: 1100 }, async (page) => {
  await login(page);
  await page.goto(`${WEB}/orders/ol_order_e2e2100_noprimary`);
  const alert = page.getByText(/Not invoiced: no primary connection/i);
  await alert.waitFor({ timeout: 30000 });
  await alert.scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, -220);
  await page.waitForTimeout(800);
});

// 4. Order detail — the timeline entry, scrolled into view.
await shoot('04-detail-timeline', { width: 1440, height: 900 }, async (page) => {
  await login(page);
  await page.goto(`${WEB}/orders/ol_order_e2e2100_noprimary`);
  const entry = page.getByText('No invoice issued');
  await entry.waitFor({ timeout: 30000 });
  await entry.scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, -260);
  await page.waitForTimeout(800);
});

// 5. Mobile card path — the deliberate parallel render.
await shoot('05-mobile-card', { width: 390, height: 844 }, async (page) => {
  await login(page);
  await page.goto(`${WEB}/orders`);
  const card = page.getByText('ALG-2100-001').first();
  await card.waitFor({ timeout: 30000 });
  await card.scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, -140);
  await page.waitForTimeout(800);
});

// 6. Dark theme — the badge tones on the other ground.
await shoot('06-orders-dark', { width: 1440, height: 900 }, async (page) => {
  await login(page);
  await page.addInitScript(() => {
    window.localStorage.setItem('openlinker.theme', 'dark');
  });
  await page.goto(`${WEB}/orders`);
  await page.locator('.data-table__row').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
});

await browser.close();
console.log('done');
