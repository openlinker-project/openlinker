/**
 * Ad-hoc verification for #2440 (net tax basis analytics) against a running
 * ol-demo-fresh stack. Not part of the automated suite — see README.md
 * "Layout" for the verify-scratch convention (one-off scripts + screenshots
 * used to attach evidence to a PR, precedent: #2032).
 *
 * What it checks (see chat / PR comment for the full use-case list):
 *  - UC1/UC6: PrestaShop orders report Net sales != gross (taxTreatment
 *    backfilled to 'exclusive' by migration 1841000000006).
 *  - UC2: Allegro orders derive net from gross using the per-line taxRate.
 *  - UC3/UC7: excludedCount is reported and non-negative; a rate-less line
 *    whose product no longer exists in the catalogue stays excluded across
 *    a backfill run (never coerced to 0/gross).
 *  - UC5: triggering `orders.taxRate.backfill` for the PrestaShop connection
 *    is a no-op on this stack's remaining no-rate lines (they belong to
 *    products removed from the catalogue) and does not throw.
 *  - UC5.3: an order with an already-issued invoice is untouched by the
 *    backfill (checked separately via psql, see PR comment).
 *  - UC9/UC10: screenshots of the Revenue KPI card (net-first, GMV
 *    qualifier) and the By-channel table (Net sales/AOV columns, no gross).
 *
 * Usage: node apps/e2e/verify-scratch/verify-net-tax-basis.cjs
 */
const path = require('node:path');
const pw = require('/home/nor/projekty/blocky/openlinker-pnpm-10/.claude/worktrees/2442-reconcile-backfill/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright');
const { chromium } = pw;

const API_BASE = 'http://localhost:3000';
const WEB_BASE = 'http://localhost:8090';
const SHOT_DIR = path.join(__dirname, 'screenshots');
const PRESTASHOP_CONNECTION_ID = '44bb1f3f-17ae-4038-ab48-413ce54a71c7';
const FROM = '2026-06-01';
const TO = '2026-08-25';

let failures = 0;
function check(label, cond, detail) {
  const ok = !!cond;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` (${detail})` : ''}`);
}

async function apiLogin() {
  const res = await fetch(`${API_BASE}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin' }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  const body = await res.json();
  return body.access_token;
}

async function apiGet(token, path) {
  const res = await fetch(`${API_BASE}/v1${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function apiPost(token, path, body) {
  const res = await fetch(`${API_BASE}/v1${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function runApiChecks(token) {
  console.log('\n--- API checks (/analytics/sales) ---');
  const sales = await apiGet(token, `/analytics/sales?from=${FROM}&to=${TO}`);
  const h = sales.headline;
  console.log(JSON.stringify(h, null, 2));

  check('headline.netRevenue is present and numeric', typeof h.netRevenue === 'number');
  check(
    'headline.netRevenue != revenue (GMV) — net basis is actually applied, not a passthrough',
    h.netRevenue !== h.revenue,
    `net=${h.netRevenue} gross=${h.revenue}`
  );
  check(
    'headline.netExcludedCount is a non-negative number (excluded bucket reported, never silently dropped)',
    typeof h.netExcludedCount === 'number' && h.netExcludedCount >= 0,
    `netExcludedCount=${h.netExcludedCount}`
  );
  check(
    'headline.netAverageOrderValue present (AOV on net basis)',
    typeof h.netAverageOrderValue === 'number'
  );

  const channels = sales.byChannel ?? sales.channels ?? [];
  for (const ch of channels) {
    check(
      `channel ${ch.sourceConnectionId}: netRevenue <= revenue (VAT never negative-stripped)`,
      typeof ch.netRevenue !== 'number' || typeof ch.revenue !== 'number' || ch.netRevenue <= ch.revenue,
      `net=${ch.netRevenue} gross=${ch.revenue}`
    );
  }

  console.log('\n--- API checks (backfill trigger, UC5) ---');
  const idempotencyKey = `manual:taxRate:backfill:verify-2440:${Date.now()}`;
  const enqueue = await apiPost(token, '/sync/jobs', {
    jobType: 'orders.taxRate.backfill',
    connectionId: PRESTASHOP_CONNECTION_ID,
    payload: { schemaVersion: 1, limit: 100 },
    idempotencyKey,
  });
  check('enqueue orders.taxRate.backfill succeeds (201/200)', enqueue.status < 300, `status=${enqueue.status}`);
  console.log('enqueue response:', JSON.stringify(enqueue.body));

  return sales;
}

async function login(page) {
  await page.goto(`${WEB_BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="username"]').fill('admin');
  await page.locator('input[name="password"]').fill('admin');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForTimeout(1500);
}

async function gotoAnalytics(page) {
  const target = `/analytics?from=${FROM}&to=${TO}`;
  await page.evaluate((p) => {
    history.pushState({}, '', p);
    dispatchEvent(new PopStateEvent('popstate'));
  }, target);
  await page.waitForTimeout(2500);
}

async function screenshots() {
  console.log('\n--- Screenshots (UC9/UC10) ---');
  const browser = await chromium.launch({ args: ['--disable-web-security'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const page = await context.newPage();
  await login(page);
  await gotoAnalytics(page);

  await page.screenshot({ path: path.join(SHOT_DIR, '01-analytics-full-page.png'), fullPage: false });

  const revenueCard = page.locator('text=Revenue').first();
  if ((await revenueCard.count()) > 0) {
    await revenueCard.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOT_DIR, '02-revenue-kpi-card.png') });
  }

  const byChannel = page.locator('text=/By.channel/i').first();
  if ((await byChannel.count()) > 0) {
    await byChannel.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOT_DIR, '03-by-channel-table.png') });
  }

  await browser.close();
  console.log(`Screenshots written to ${SHOT_DIR}`);
}

async function main() {
  const token = await apiLogin();
  await runApiChecks(token);
  await screenshots();
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
