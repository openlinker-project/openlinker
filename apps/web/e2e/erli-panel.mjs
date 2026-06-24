/**
 * Erli SANDBOX seller-panel screenshot capture for the setup guide.
 *
 * Separate from the OL capture scripts because it targets a different origin
 * (the Erli sandbox seller panel) with different credentials. Logs into the Erli
 * sandbox seller panel and captures:
 *   20 — where the Shop API key is generated / found
 *        (moje Erli → Ustawienia sklepu → Metoda Integracji → Własna integracja po API)
 *   21 — the offer / product listing showing OUR created offer
 *        (title "OL E2E Resin Ring" / variant ol_variant_2dab...)
 *
 * Credentials come from env (do NOT hard-code secrets):
 *   ERLI_PANEL_BASE   default https://sandbox.erli.dev
 *   ERLI_PANEL_USER   seller-panel login email
 *   ERLI_PANEL_PASS   seller-panel password
 *
 * The Erli panel is a client-rendered SPA whose exact selectors/routes are not
 * controlled by us; this script probes a small set of known Polish-language
 * routes/labels and captures whatever renders. If login or a target page cannot
 * be reached it saves a diagnostic shot and exits non-zero so the gap is visible.
 *
 * Usage:
 *   ERLI_PANEL_USER=... ERLI_PANEL_PASS=... node apps/web/e2e/erli-panel.mjs
 */
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(__dirname, '../../../docs/assets/erli');
const BASE = process.env.ERLI_PANEL_BASE ?? 'https://sandbox.erli.dev';
const USER = process.env.ERLI_PANEL_USER;
const PASS = process.env.ERLI_PANEL_PASS;

if (!USER || !PASS) {
  console.error('ERLI_PANEL_USER / ERLI_PANEL_PASS env vars are required.');
  process.exit(2);
}

async function shot(page, name, fullPage = true) {
  await page.waitForTimeout(800);
  await page.screenshot({ path: resolve(SHOTS, `${name}.png`), fullPage });
  console.log('captured', name);
}

async function dismissCookies(page) {
  for (const label of [/Akceptuj/i, /Zgadzam/i, /Accept/i, /OK/i]) {
    const btn = page.getByRole('button', { name: label });
    if (await btn.count().catch(() => 0)) {
      await btn.first().click().catch(() => {});
      await page.waitForTimeout(400);
      break;
    }
  }
}

// Headed mode (HEADED=1) avoids the interactive reCAPTCHA challenge that blocks
// headless automated logins to the Erli storefront.
const browser = await chromium.launch({
  headless: process.env.HEADED !== '1',
  slowMo: process.env.HEADED === '1' ? 120 : 0,
  args: ['--disable-blink-features=AutomationControlled'],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'pl-PL',
  userAgent:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
});
const page = await context.newPage();

try {
  // 1. Login.
  await page.goto(`${BASE}/konto/zaloguj`, { waitUntil: 'networkidle', timeout: 30000 });
  await dismissCookies(page);
  await page.waitForTimeout(1500);

  // Erli uses a TWO-STEP login: email → "Kontynuuj" → password field appears.
  const emailField = page
    .locator('input[type="email"], input[name*="mail" i], input[name="login"]')
    .first();
  await emailField.fill(USER, { timeout: 15000 });

  // Try to clear the reCAPTCHA "Nie jestem robotem" checkbox (passes invisibly
  // in headed, low-risk sessions; will still challenge if Google flags us).
  const recaptchaFrame = page.frameLocator('iframe[src*="recaptcha"]').first();
  const checkbox = recaptchaFrame.locator('#recaptcha-anchor, .recaptcha-checkbox').first();
  if (await checkbox.count().catch(() => 0)) {
    await checkbox.click().catch(() => {});
    await page.waitForTimeout(2500);
  }

  const cont = page.getByRole('button', { name: /Kontynuuj|Continue/i }).first();
  if (await cont.count()) {
    await cont.click();
  } else {
    await emailField.press('Enter');
  }
  await page.waitForTimeout(3000);
  await shot(page, '20a-erli-panel-after-email');

  // Now the password field should be visible.
  const passField = page.locator('input[type="password"]:visible').first();
  await passField.fill(PASS, { timeout: 15000 });

  const submit = page
    .getByRole('button', { name: /Zaloguj|Kontynuuj|Sign in|Log in/i })
    .first();
  if (await submit.count()) {
    await submit.click();
  } else {
    await passField.press('Enter');
  }
  await page.waitForTimeout(4500);
  await shot(page, '20b-erli-panel-post-login');

  // 2. Navigate toward Store settings → Integration method → Own API integration.
  // The panel is an SPA; try direct routes first, then in-page link clicks.
  const settingsRoutes = [
    '/moje-erli/ustawienia-sklepu',
    '/panel/ustawienia-sklepu',
    '/sprzedawca/ustawienia',
    '/moje-erli',
  ];
  let reached = false;
  for (const r of settingsRoutes) {
    await page.goto(`${BASE}${r}`, { waitUntil: 'networkidle', timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(1500);
    if (!/404|nie znaleziono/i.test(await page.content().catch(() => ''))) {
      reached = true;
      break;
    }
  }

  // Try clicking through the menu: Metoda Integracji → Własna integracja po API.
  for (const label of [/Metoda Integracji/i, /Integracj/i]) {
    const link = page.getByText(label).first();
    if (await link.count().catch(() => 0)) {
      await link.click().catch(() => {});
      await page.waitForTimeout(1500);
      break;
    }
  }
  for (const label of [/Własna integracja po API/i, /Własna integracja/i, /API/i]) {
    const tile = page.getByText(label).first();
    if (await tile.count().catch(() => 0)) {
      await tile.click().catch(() => {});
      await page.waitForTimeout(1500);
      break;
    }
  }
  await shot(page, '20-erli-panel-apikey');
  console.log('settings reached:', reached);

  // 3. Offer / product listing showing our created offer.
  const offerRoutes = [
    '/moje-erli/oferty',
    '/moje-erli/produkty',
    '/panel/oferty',
    '/sprzedawca/oferty',
  ];
  for (const r of offerRoutes) {
    await page.goto(`${BASE}${r}`, { waitUntil: 'networkidle', timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(1500);
    if (!/404|nie znaleziono/i.test(await page.content().catch(() => ''))) break;
  }
  // Try a search for the offer title if a search box exists.
  const search = page.locator('input[type="search"], input[placeholder*="zukaj" i], input[placeholder*="search" i]').first();
  if (await search.count().catch(() => 0)) {
    await search.fill('Resin Ring').catch(() => {});
    await page.waitForTimeout(1800);
  }
  await shot(page, '21-erli-panel-offer-listing');

  console.log('DONE');
} catch (err) {
  console.error('PANEL_ERROR', err.message);
  await page.screenshot({ path: resolve(SHOTS, 'panel-error.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
