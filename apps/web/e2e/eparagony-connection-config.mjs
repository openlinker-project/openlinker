/**
 * eparagony.pl connection-config form fields (#3266 / PR #3268) — E2E visual
 * verification + screenshot capture.
 *
 * Drives the running web app with a real browser against a real API + Postgres:
 * logs in, creates an eparagony.pl connection through the guided wizard, then
 * exercises every state of the structured connection-config section (the new
 * form fields), including the exact null-vs-delete persistence regression the
 * #3268 review round fixed.
 *
 * This is NOT an automated test — not wired to any test runner, per
 * apps/web/e2e/README.md's documented convention (see ksef-payment-config.mjs /
 * infakt-connection.mjs for the same shape).
 *
 * Usage: node apps/web/e2e/eparagony-connection-config.mjs
 * Env:
 *   WEB_BASE          web dev-server base (default http://localhost:5199, this
 *                     run's isolated port)
 *   OL_ADMIN_USERNAME login username (default admin)
 *   OL_ADMIN_PASSWORD login password (default admin)
 *   SHOT_DIR          screenshot output dir (default
 *                     docs/assets/eparagony-connection-config-e2e relative to
 *                     repo root)
 *
 * Two scenarios (S29, S46) are NOT captured by this script, since neither is
 * reachable through the ordinary UI flow this script drives — both need a
 * side-channel step against the SAME database this script's connection lives
 * in:
 *
 *   S29 (unrecognised stored value) — the form can never SUBMIT a value
 *   outside its own vocabulary, so the only way to see the warning is to put
 *   one there directly:
 *     docker exec <postgres-container> psql -U postgres -d openlinker -c \
 *       "UPDATE connections SET config = config || \
 *        '{\"defaultTaxRateCode\": \"Z\", \"paymentForm\": \"Bitcoin\"}'::jsonb \
 *        WHERE \"platformType\"='eparagony';"
 *   then reload the edit page and screenshot the Fallback tax rate group and
 *   the Payment form field. Restore with the same UPDATE using `null` for
 *   both keys afterward.
 *
 *   S46 (demo-mode read-only Save button) — `useWriteAccess`'s
 *   `demoReadOnly = !canWrite && demoMode` means this is reachable ONLY for a
 *   role that lacks `connections:write` (admin always has it, so logging in
 *   as admin under OL_DEMO_MODE=true shows nothing different). Restart the
 *   API with `OL_DEMO_MODE=true`, log in as a `viewer`-role user instead of
 *   admin, open the same connection's edit page, and screenshot
 *   `.form-actions`.
 */
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = process.env.SHOT_DIR
  ? resolve(process.env.SHOT_DIR)
  : resolve(__dirname, '../../../docs/assets/eparagony-connection-config-e2e');
const BASE = process.env.WEB_BASE ?? 'http://localhost:5199';
const USER = process.env.OL_ADMIN_USERNAME ?? 'admin';
const PASSWORD = process.env.OL_ADMIN_PASSWORD ?? 'admin';

mkdirSync(SHOTS, { recursive: true });

const results = [];

function record(id, description, filename, note = '') {
  results.push({ id, description, filename, note });
  console.log(`  [${id}] ${description} -> ${filename}.png ${note}`);
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('Username or email').fill(USER);
  await page.getByPlaceholder('Enter your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });
}

async function shot(page, name, options = {}) {
  await page.waitForTimeout(300);
  const target = options.locator ?? page;
  await target.screenshot({ path: resolve(SHOTS, `${name}.png`), fullPage: options.fullPage ?? false });
}

async function openGroup(page, summaryText) {
  const details = page.locator('details', { has: page.locator('summary', { hasText: summaryText }) });
  const isOpen = await details.evaluate((el) => el.hasAttribute('open'));
  if (!isOpen) await details.locator('summary', { hasText: summaryText }).click();
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
await page.context().addInitScript(() => {
  window.localStorage.setItem('openlinker.theme', 'light');
});

try {
  console.log(`Base: ${BASE}, shots -> ${SHOTS}`);
  await login(page);

  // ── A. Setup wizard ─────────────────────────────────────────────────────
  await page.goto(`${BASE}/connections/new`, { waitUntil: 'networkidle' });
  await shot(page, 'a01-picker-card');
  record('S1', 'Platform picker card for eparagony.pl', 'a01-picker-card');

  await page.getByRole('link', { name: /eparagony\.pl/i }).click();
  await page.waitForURL((u) => u.pathname === '/connections/new/eparagony');
  await shot(page, 'a02-wizard-empty');
  record('S2', 'Wizard loads, empty form, Sandbox default', 'a02-wizard-empty');
  await shot(page, 'a03-precondition-alert');
  record('S3', 'Before-you-connect precondition alert', 'a03-precondition-alert');

  // S4: submit empty -> validation errors
  await page.getByRole('button', { name: 'Connect eparagony.pl' }).click();
  await page.waitForTimeout(300);
  await shot(page, 'a04-validation-errors');
  record('S4', 'Submit empty -> validation summary + required-field errors', 'a04-validation-errors');

  // S5: malformed integration id
  await page.getByLabel('Integration ID (optional)').fill('not-a-valid-value');
  await page.getByLabel('Integration ID (optional)').blur();
  await page.waitForTimeout(300);
  await shot(page, 'a05-integration-id-error');
  record('S5', 'Integration ID malformed -> its own error', 'a05-integration-id-error');
  await page.getByLabel('Integration ID (optional)').fill('');

  // Fill everything correctly with fake (structurally valid) sandbox creds —
  // deliberately fake, so "Test connection" fails for real rather than being
  // simulated (S9). Name carries a run-unique suffix so a re-run's `getByRole`
  // lookups below never collide with a previous run's leftover connection.
  const connectionName = `eparagony E2E verification ${Date.now()}`;
  await page.getByLabel('Connection name').fill(connectionName);
  await page.getByLabel('Client ID').fill('e2e-fake-client-id');
  await page.getByLabel('Client secret').fill('e2e-fake-client-secret');
  await page.getByLabel('POS ID').fill('e2e-pos-01');

  // S6: submitting (pending) — click and immediately screenshot before the
  // response resolves. Racy by nature; best-effort.
  const submitClick = page.getByRole('button', { name: 'Connect eparagony.pl' }).click();
  await page.waitForTimeout(50);
  await shot(page, 'a06-submitting');
  record('S6', 'Submit pending — "Connecting…"', 'a06-submitting', '(best-effort timing)');
  await submitClick;

  await page.waitForSelector('text=Test connection', { timeout: 10000 });
  await shot(page, 'a07-created');
  record('S7', 'Submit success -> toast + post-create Test/Done block', 'a07-created');

  // S8/S9: test connection against fake creds -> expected failure
  const testClick = page.getByRole('button', { name: 'Test connection' }).click();
  await page.waitForTimeout(50);
  await shot(page, 'a08-test-pending');
  record('S8', 'Test connection pending — "Testing…"', 'a08-test-pending', '(best-effort timing)');
  await testClick;
  await page.waitForTimeout(1500);
  await shot(page, 'a09-test-failed');
  record('S9', 'Test connection failure (fake creds, expected)', 'a09-test-failed');

  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForURL((u) => u.pathname === '/connections');
  await shot(page, 'a10-done-redirect');
  record('S10', 'Done -> redirected to /connections', 'a10-done-redirect');

  // Open the created connection's edit page by clicking its row.
  await page.getByRole('link', { name: connectionName }).click();
  await page.waitForURL((u) => /\/connections\/[^/]+$/.test(u.pathname));
  const detailUrl = new URL(page.url());
  const connectionId = detailUrl.pathname.split('/').pop();
  console.log('Connection id:', connectionId);

  await page.goto(`${BASE}/connections/${connectionId}/edit`, { waitUntil: 'networkidle' });

  // ── B. Edit form general chrome ─────────────────────────────────────────
  const formCard = page.locator('form.form-card');
  await shot(page, 'b01-edit-chrome', { locator: formCard });
  record('S11', 'Edit page chrome: header, platform type, credentials, adapter key', 'b01-edit-chrome');

  await shot(page, 'b02-sales-doc-section', { locator: formCard, fullPage: false });
  record('S12', 'Sales-document status section present (Fiscalization capability)', 'b02-sales-doc-section');

  await shot(page, 'b03-raw-json-closed', { locator: formCard });
  record('S13', '"Show raw config JSON" toggle — closed (default)', 'b03-raw-json-closed');

  await page.getByRole('button', { name: 'Show raw config JSON' }).click();
  await shot(page, 'b04-raw-json-open', { locator: formCard });
  record('S14', 'Raw JSON toggle open — textarea visible', 'b04-raw-json-open');
  await page.getByRole('button', { name: 'Hide raw config JSON' }).click();

  // ── C. Receipt group (always visible) ───────────────────────────────────
  await shot(page, 'c01-receipt-group', { locator: formCard });
  record('S17', 'Receipt group visible on load, nothing else expanded', 'c01-receipt-group');

  const printGroup = page.getByRole('radiogroup', { name: 'Paper receipt' });
  await shot(page, 'c02-print-unset', { locator: printGroup });
  record('S18', 'Print: Not set (default)', 'c02-print-unset');

  await printGroup.getByRole('radio', { name: 'Print', exact: true }).click();
  await shot(page, 'c03-print-true', { locator: printGroup });
  record('S19', 'Print: Print selected', 'c03-print-true');

  await printGroup.getByRole('radio', { name: 'Do not print', exact: true }).click();
  await shot(page, 'c04-print-false', { locator: printGroup });
  record('S20', 'Print: Do not print selected', 'c04-print-false');

  const paymentFormSelect = page.getByLabel('Payment form on the receipt');
  await paymentFormSelect.click();
  await shot(page, 'c05-payment-form-options', { locator: page.locator('.form-field', { has: paymentFormSelect }) });
  record('S21', 'Payment form select — 11 options', 'c05-payment-form-options');
  await page.keyboard.press('Escape');

  await page.getByLabel('Payment name').fill('Visa test card');
  await shot(page, 'c06-payment-name', { locator: page.locator('.form-field', { hasText: 'Payment name' }) });
  record('S22', 'Payment name filled', 'c06-payment-name');

  // ── D. Fallback tax rate group ──────────────────────────────────────────
  const fallbackDisclosure = page.locator('details', { has: page.locator('summary', { hasText: 'Fallback tax rate:' }) });
  await shot(page, 'd01-fallback-collapsed-unset', { locator: fallbackDisclosure });
  record('S23', 'Fallback collapsed — "Not set — a line with no rate is refused"', 'd01-fallback-collapsed-unset');

  await openGroup(page, 'Fallback tax rate:');
  await shot(page, 'd02-fallback-open', { locator: fallbackDisclosure });
  record('S24', 'Fallback group opened, select showing 8 options', 'd02-fallback-open');

  await page.getByLabel('Fallback device slot').selectOption('B');
  await shot(page, 'd04-infotip-closed', { locator: fallbackDisclosure });
  record('S26', 'Hazard infotip closed, next to field description', 'd04-infotip-closed');

  await page.getByRole('button', { name: 'What the fallback tax rate does, and why it is risky' }).click();
  await page.waitForTimeout(200);
  await shot(page, 'd05-infotip-open', { fullPage: true });
  record('S27', 'Hazard infotip open — 4 terms + 2 caveats', 'd05-infotip-open');
  await page.keyboard.press('Escape');

  await shot(page, 'd06-taxrates-pointer', { locator: fallbackDisclosure });
  record('S28', 'taxRates-lives-in-raw-JSON static notice', 'd06-taxrates-pointer');

  // ── E. Diagnostics group ────────────────────────────────────────────────
  const diagDisclosure = page.locator('details', { has: page.locator('summary', { hasText: 'Diagnostics and timing:' }) });
  await shot(page, 'e01-diagnostics-collapsed-defaults', { locator: diagDisclosure });
  record('S30', 'Diagnostics collapsed — "Defaults"', 'e01-diagnostics-collapsed-defaults');

  await openGroup(page, 'Diagnostics and timing:');
  await shot(page, 'e02-diagnostics-open', { locator: diagDisclosure });
  record('S31', 'Diagnostics opened, both fields empty', 'e02-diagnostics-open');

  const pollInput = page.getByLabel('Device wait time (ms)');
  await pollInput.fill('abc');
  await pollInput.blur();
  await shot(page, 'e03-poll-timeout-nan-error', { locator: diagDisclosure });
  record('S32', 'Poll timeout non-numeric error', 'e03-poll-timeout-nan-error');

  await pollInput.fill('0');
  await pollInput.blur();
  await shot(page, 'e04-poll-timeout-zero-error', { locator: diagDisclosure });
  record('S33', 'Poll timeout zero error', 'e04-poll-timeout-zero-error');

  await pollInput.fill('1000.5');
  await pollInput.blur();
  await shot(page, 'e05-poll-timeout-decimal-ok', { locator: diagDisclosure });
  record('S34', 'Poll timeout decimal accepted, no error', 'e05-poll-timeout-decimal-ok');

  await pollInput.fill('600000');
  await pollInput.blur();
  await shot(page, 'e06-poll-timeout-above-clamp-ok', { locator: diagDisclosure });
  record('S35', 'Poll timeout above 90s clamp accepted, no error', 'e06-poll-timeout-above-clamp-ok');

  await page.getByLabel('Fiscal device number').fill('ABC123456890');
  await shot(page, 'e07-diagnostics-collapsed-customised', { locator: diagDisclosure });
  record('S36', 'Fiscal device number filled -> collapsed summary "Customised"', 'e07-diagnostics-collapsed-customised');

  // both invalid simultaneously
  await pollInput.fill('0');
  await pollInput.blur();
  await page.getByLabel('Fiscal device number').fill('');
  await page.getByLabel('Fiscal device number').blur();
  await shot(page, 'e08-diagnostics-problem-count', { locator: diagDisclosure });
  record('S37', 'Both diagnostics fields invalid -> problem count in summary', 'e08-diagnostics-problem-count');
  // restore to a valid, non-empty state for later save passes
  await pollInput.fill('30000');
  await page.getByLabel('Fiscal device number').fill('ABC123456890');
  await page.getByLabel('Fiscal device number').blur();

  // ── F. Testing overrides group ──────────────────────────────────────────
  const overridesDisclosure = page.locator('details', { has: page.locator('summary', { hasText: 'Testing overrides:' }) });
  await shot(page, 'f01-overrides-collapsed-default', { locator: overridesDisclosure });
  record('S38', 'Overrides collapsed — using environment default hosts', 'f01-overrides-collapsed-default');

  await openGroup(page, 'Testing overrides:');
  const apiHostInput = page.getByLabel('API host');
  await apiHostInput.fill('http://insecure.test');
  await apiHostInput.blur();
  await shot(page, 'f02-api-host-error', { locator: overridesDisclosure });
  record('S39', 'API host non-https -> error', 'f02-api-host-error');

  await apiHostInput.fill('https://sandbox.eparagony.pl');
  await apiHostInput.blur();
  await page.getByLabel('Sign-in host').fill('https://login.sandbox.eparagony.pl');
  await page.getByLabel('Sign-in host').blur();
  await shot(page, 'f03-overrides-collapsed-custom', { locator: overridesDisclosure });
  record('S40', 'Both hosts valid -> collapsed summary "Overriding the environment\'s hosts"', 'f03-overrides-collapsed-custom');

  await apiHostInput.fill('not a url');
  await apiHostInput.blur();
  await page.getByLabel('Sign-in host').fill('also not a url');
  await page.getByLabel('Sign-in host').blur();
  await shot(page, 'f04-overrides-problem-count', { locator: overridesDisclosure });
  record('S41', 'Both hosts invalid simultaneously -> problem count', 'f04-overrides-problem-count');
  // clear back to valid before continuing
  await apiHostInput.fill('');
  await page.getByLabel('Sign-in host').fill('');
  await page.getByLabel('Sign-in host').blur();

  // ── G1. unparseable raw JSON -> everything locked ───────────────────────
  await page.getByRole('button', { name: 'Show raw config JSON' }).click();
  const rawTextarea = page.getByLabel('Config JSON');
  await rawTextarea.fill('{ this is not valid json');
  await rawTextarea.blur();
  await page.waitForTimeout(300);
  await shot(page, 'g01-unparseable-locked', { locator: formCard, fullPage: true });
  record('S42', 'Unparseable raw JSON -> alert + every structured control disabled', 'g01-unparseable-locked');

  // reload the page to discard the unparseable edit before continuing
  await page.goto(`${BASE}/connections/${connectionId}/edit`, { waitUntil: 'networkidle' });

  // ── G2. All 8 fields filled, save, reload ───────────────────────────────
  await page.getByRole('radiogroup', { name: 'Paper receipt' }).getByRole('radio', { name: 'Print', exact: true }).click();
  await page.getByLabel('Payment form on the receipt').selectOption('Karta');
  await page.getByLabel('Payment name').fill('Visa contactless');
  await openGroup(page, 'Fallback tax rate:');
  await page.getByLabel('Fallback device slot').selectOption('B');
  await openGroup(page, 'Diagnostics and timing:');
  await page.getByLabel('Device wait time (ms)').fill('45000');
  await page.getByLabel('Fiscal device number').fill('ABC123456890');
  await openGroup(page, 'Testing overrides:');
  await page.getByLabel('API host').fill('https://sandbox.eparagony.pl');
  await page.getByLabel('Sign-in host').fill('https://login.sandbox.eparagony.pl');
  await page.getByLabel('Sign-in host').blur();

  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.waitForURL((u) => /\/connections\/[^/]+$/.test(u.pathname), { timeout: 10000 });
  await page.goto(`${BASE}/connections/${connectionId}/edit`, { waitUntil: 'networkidle' });
  await openGroup(page, 'Fallback tax rate:');
  await openGroup(page, 'Diagnostics and timing:');
  await openGroup(page, 'Testing overrides:');
  await shot(page, 'g02-all-filled-after-reload', { locator: formCard, fullPage: true });
  record('S43', 'All 8 fields filled, saved, reloaded -> hydrate correctly', 'g02-all-filled-after-reload');

  // ── G3. All 8 fields cleared, save, reload — THE REGRESSION PROOF ──────
  await page.getByRole('radiogroup', { name: 'Paper receipt' }).getByRole('radio', { name: 'Not set', exact: true }).click();
  await page.getByLabel('Payment form on the receipt').selectOption('');
  await page.getByLabel('Payment name').fill('');
  await page.getByLabel('Payment name').blur();
  await page.getByLabel('Fallback device slot').selectOption('');
  await page.getByLabel('Device wait time (ms)').fill('');
  await page.getByLabel('Device wait time (ms)').blur();
  await page.getByLabel('Fiscal device number').fill('');
  await page.getByLabel('Fiscal device number').blur();
  await page.getByLabel('API host').fill('');
  await page.getByLabel('API host').blur();
  await page.getByLabel('Sign-in host').fill('');
  await page.getByLabel('Sign-in host').blur();

  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.waitForURL((u) => /\/connections\/[^/]+$/.test(u.pathname), { timeout: 10000 });
  await page.goto(`${BASE}/connections/${connectionId}/edit`, { waitUntil: 'networkidle' });
  await openGroup(page, 'Fallback tax rate:');
  await openGroup(page, 'Diagnostics and timing:');
  await openGroup(page, 'Testing overrides:');
  await shot(page, 'g03-all-cleared-after-reload', { locator: formCard, fullPage: true });
  record(
    'S44',
    'All 8 fields cleared, saved, reloaded -> every field reads back UNSET (the #3268 fix)',
    'g03-all-cleared-after-reload',
  );

  // ── G4. Isolated single-field round-trip: Print alone ───────────────────
  await page.getByRole('radiogroup', { name: 'Paper receipt' }).getByRole('radio', { name: 'Do not print', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.waitForURL((u) => /\/connections\/[^/]+$/.test(u.pathname), { timeout: 10000 });
  await page.goto(`${BASE}/connections/${connectionId}/edit`, { waitUntil: 'networkidle' });
  await shot(page, 'g04-print-single-field-roundtrip', {
    locator: page.getByRole('radiogroup', { name: 'Paper receipt' }),
  });
  record(
    'S45',
    'Isolated Print-only round-trip: set "Do not print", saved, reloaded -> still "Do not print"',
    'g04-print-single-field-roundtrip',
  );

  console.log(`\nCaptured ${results.length} scenarios. Connection id: ${connectionId}`);
} finally {
  await browser.close();
}

console.log('\n=== Summary ===');
for (const r of results) {
  console.log(`${r.id}\t${r.filename}.png\t${r.description} ${r.note}`);
}
