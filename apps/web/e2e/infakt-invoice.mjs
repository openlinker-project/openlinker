/**
 * inFakt setup-guide screenshot capture — issue an invoice through inFakt.
 *
 * Drives the running web app (:4173): opens a real ingested order, issues an
 * invoice through the order-detail Invoice panel, waits for the real
 * OL -> InfaktInvoicingAdapter -> inFakt sandbox -> KSeF round-trip, then
 * captures the submitted (pending) and accepted (cleared) reg-card states,
 * and drives one KOR correction. Captures into docs/assets/infakt/.
 *
 * The document is created end-to-end against the real inFakt sandbox — this
 * script only drives + screenshots the OL browser side.
 *
 * Presentation requirement: use a real seeded order, let every toast/alert
 * settle before each shot, and re-take any frame that shows a dev artifact
 * (raw JSON, console error toast, stray localhost URL) rather than shipping
 * it — these screenshots are reused verbatim in the operator setup guide.
 *
 * Usage: node apps/web/e2e/infakt-invoice.mjs
 * Env:
 *   WEB_BASE          web preview base (default http://localhost:4173)
 *   ORDER_ID          OL order id to issue against — required (no order picked automatically,
 *                     to avoid accidentally issuing against the wrong seeded fixture)
 *   INFAKT_CONN_NAME  connection label to pick when >1 invoicing connection
 *   CLEARANCE_POLL_MS max time to poll for KSeF acceptance (default 120000 — sandbox clears
 *                     in ~90s per the feasibility POC)
 */
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(__dirname, '../../../docs/assets/infakt');
const BASE = process.env.WEB_BASE ?? 'http://localhost:4173';
const ORDER_ID = process.env.ORDER_ID ?? '';
const CONN_NAME = process.env.INFAKT_CONN_NAME ?? 'inFakt';
const CONNECTION_ID = process.env.INFAKT_CONNECTION_ID ?? '';
const CLEARANCE_POLL_MS = Number(process.env.CLEARANCE_POLL_MS ?? 120000);

if (!ORDER_ID) {
  console.error('INFAKT_INVOICE_ERROR: ORDER_ID is required — pick a real seeded order id.');
  process.exit(1);
}

async function forceLightTheme(page) {
  // These screenshots are reused in the tutorial — always capture OpenLinker's
  // light theme regardless of the OS/browser color-scheme preference.
  await page.addInitScript(() => {
    window.localStorage.setItem('openlinker.theme', 'light');
  });
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('Enter your username').fill('operator');
  await page.getByPlaceholder('Enter your password').fill('infakt-e2e-pw');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });
}

async function shot(page, name) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: resolve(SHOTS, `${name}.png`), fullPage: true });
  console.log('captured', name);
}

async function pickConnectionIfNeeded(page) {
  const picker = page.getByLabel(/Invoicing connection/i).first();
  if (await picker.count()) {
    // Select by connection id (option value) — the fragile label-text/regex
    // match previously fell through to selectOption({index:1}), silently
    // picking the WRONG provider (Subiekt) instead of inFakt.
    if (CONNECTION_ID) {
      await picker.selectOption({ value: CONNECTION_ID });
    } else {
      await picker.selectOption({ label: CONN_NAME }).catch(() => picker.selectOption({ index: 1 }));
    }
    await page.waitForTimeout(800);
  }
}

async function waitForAccepted(page, deadlineMs) {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    // A full reload drops the client-side connection-picker selection —
    // re-pick it every time or the panel falls back to "Select a
    // connection…" and the reg-card never renders at all (looked like a
    // false "rejected" before this fix).
    await page.reload({ waitUntil: 'networkidle' });
    await pickConnectionIfNeeded(page);
    const accepted = await page.locator('.reg-card--success').count();
    if (accepted > 0) return true;
    const rejected = await page.locator('.reg-card--error').count();
    if (rejected > 0) return false;
    await page.waitForTimeout(5000);
  }
  return false;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  await forceLightTheme(page);
  await login(page);

  // 1. Order detail — not-issued state.
  await page.goto(`${BASE}/orders/${ORDER_ID}`, { waitUntil: 'networkidle' });
  await pickConnectionIfNeeded(page);
  await shot(page, '10-order-detail-not-issued');

  // 2. Issue the invoice.
  const issueBtn = page.getByRole('button', { name: /Issue invoice/i }).first();
  if (await issueBtn.count()) {
    await issueBtn.click();
    await page.waitForTimeout(3000);
  }
  await page.reload({ waitUntil: 'networkidle' });
  await pickConnectionIfNeeded(page);
  await shot(page, '11-invoice-issued-submitted');
  const pendingCard = await page.locator('.reg-card--info').count();
  console.log('pending reg-card visible:', pendingCard > 0);

  // 3. Poll until KSeF clears (accepted) or rejects.
  const accepted = await waitForAccepted(page, CLEARANCE_POLL_MS);
  await shot(page, accepted ? '12-invoice-accepted-cleared' : '12-invoice-rejected');
  if (!accepted) {
    console.log('KSeF did not reach accepted within the poll window — skipping correction step.');
  }

  // 4. Issue a KOR correction (only if accepted) — still on the order page,
  // where the "Issue correction" button actually lives (no PDF link exists
  // for inFakt today, so there is no separate "view invoice" affordance to
  // detour through first).
  if (accepted) {
    const correctionBtn = page.getByRole('button', { name: /Issue correction/i }).first();
    if (await correctionBtn.count()) {
      await correctionBtn.click();
      await page.waitForTimeout(500);
      await shot(page, '14-correction-modal-empty');

      await page.getByLabel(/Line number 1/i).fill('1');
      await page.getByLabel(/New qty, line 1/i).fill('1');
      await page.getByLabel(/New price, line 1/i).fill('99.99');
      await shot(page, '15-correction-modal-filled');

      await page.getByRole('button', { name: /Issue KOR/i }).click();
      await page.waitForTimeout(4000);
      await shot(page, '16-correction-issued');
    }
  }

  // 5. Invoices list — both the original and (if issued) the correction visible.
  // Filtered to our connection so the shared dev DB's unrelated rows (other
  // providers' test fixtures) don't clutter a screenshot meant for the tutorial.
  const invoicesListUrl = CONNECTION_ID
    ? `${BASE}/invoices?connectionId=${CONNECTION_ID}`
    : `${BASE}/invoices`;
  await page.goto(invoicesListUrl, { waitUntil: 'networkidle' });
  await shot(page, '17-invoices-list');

  // 6. Full invoice detail page (screen 06 parity) — reached by clicking the
  // row for our order, the only navigation path (no PDF link on the panel).
  const invoiceRow = page.getByText(ORDER_ID.slice(0, 24)).first();
  if (await invoiceRow.count()) {
    await invoiceRow.click();
    await page.waitForTimeout(1200);
    await shot(page, '13-invoice-detail-page');
  }

  console.log('DONE');
} catch (err) {
  console.error('INFAKT_INVOICE_ERROR', err.message);
  await page.screenshot({ path: resolve(SHOTS, 'error-invoice.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
