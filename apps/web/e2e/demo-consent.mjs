/**
 * Demo session-recording capture + checks (#1938)
 *
 * Unlike its siblings in this folder, this script needs NO running API and no
 * seeded state: it stubs every `/v1/**` call at the network boundary, so a bare
 * SPA server (`pnpm --filter @openlinker/web dev`, or `preview`) is enough. That
 * also makes it deterministic, so it carries assertions as well as captures —
 * it exits non-zero when the flow regresses.
 *
 * Covers: the registration recording notice (demo and non-demo), the `/consent`
 * gate a pre-#1938 account is redirected to, that Continue returns to `?next=`,
 * that neither the demo banner nor Settings offers an analytics opt-out, and
 * that both new surfaces fit 360×812 / 768×1024 / 1440×900 without horizontal
 * overflow.
 *
 *   node apps/web/e2e/demo-consent.mjs
 *
 * Env: WEB_BASE (default http://localhost:4173), SHOT_DIR (default
 * docs/assets/demo-consent-1938).
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.WEB_BASE ?? 'http://localhost:4173';
const OUT = `${process.env.SHOT_DIR ?? resolve(__dirname, '../../../docs/assets/demo-consent-1938')}/`;
mkdirSync(OUT, { recursive: true });

const VIEWER = (analyticsConsent) => ({
  id: 'user_demo_1',
  username: 'demo_visitor',
  email: 'demo.visitor@example.com',
  role: 'viewer',
  permissions: [],
  analyticsConsent,
  status: 'active',
});

const failures = [];
const passes = [];

async function assertNoCrash(page, where) {
  const crashed = await page.getByText('Unexpected Application Error!').count();
  check(`${where}: page rendered without a crash`, crashed === 0);
}

function check(name, condition) {
  if (condition) {
    passes.push(name);
  } else {
    failures.push(name);
  }
}

async function makeContext(
  browser,
  {
    demoMode = true,
    analyticsConsent = false,
    authenticated = true,
    capture = {},
    viewport = { width: 1280, height: 1500 },
  } = {},
) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });

  await context.addInitScript(() => {
    window.localStorage.setItem('openlinker.theme', 'dark');
  });

  await context.route('**/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/v1/, '');

    if (path === '/system/config') {
      // No posthog key: the loader must never fetch the real SDK in a screenshot run.
      return route.fulfill({ json: { demoMode, demoIntegrations: {} } });
    }
    if (path === '/auth/refresh') {
      // An anonymous run must stay anonymous: GuestLayout bounces an
      // authenticated visitor off /register, which is what we want to shoot.
      return authenticated
        ? route.fulfill({ json: { access_token: 'stub-access-token' } })
        : route.fulfill({ status: 401, json: {} });
    }
    if (path === '/auth/me') {
      return route.fulfill({ json: VIEWER(analyticsConsent) });
    }
    if (path === '/auth/me/analytics-consent') {
      return route.fulfill({ json: VIEWER(true) });
    }
    if (path === '/auth/register') {
      // Read the payload here rather than off a `request` event: the stub is the
      // one place guaranteed to observe the body.
      capture.register = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { ok: true } });
    }
    if (path === '/auth/logout') {
      return route.fulfill({ status: 204, body: '' });
    }
    // Everything the shell probes for nav counts, the dashboard, and list
    // pages. These need their real envelope shapes: a bare `[]` crashes the
    // page and a crashed page trivially satisfies a "no opt-out is rendered"
    // assertion, which would be a false green.
    if (path === '/health/dev-stack') {
      return route.fulfill({
        json: {
          status: 'ok',
          services: {
            postgres: { status: 'ok' },
            redis: { status: 'ok' },
            prestashop: { status: 'ok' },
            worker: { status: 'ok' },
          },
          connections: [],
        },
      });
    }
    if (path.startsWith('/orders') || path.startsWith('/listings') || path.startsWith('/products')) {
      return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20 } });
    }
    return route.fulfill({ json: [] });
  });

  return context;
}

async function shot(page, name) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}${name}.png` });
  return name;
}

/** Tight crop on one element — a guest card floating in a dark page reads badly. */
async function cardShot(page, name, selector = '.guest-card') {
  await page.waitForTimeout(350);
  await page.locator(selector).screenshot({ path: `${OUT}${name}.png` });
  return name;
}

const browser = await chromium.launch();

// ── 1. Registration in demo mode: notice, no checkbox ────────────────────────
{
  const capture = {};
  const context = await makeContext(browser, {
    demoMode: true,
    authenticated: false,
    capture,
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/register`);
  await page.getByText(/Demo sessions are recorded/i).waitFor();

  check(
    'register: notice states recording and that creating the account accepts it',
    await page.getByText(/By creating an account you accept this/i).isVisible(),
  );
  check('register: no checkbox to decide', (await page.getByRole('checkbox').count()) === 0);
  check(
    'register: no Agree button',
    (await page.getByRole('button', { name: /agree/i }).count()) === 0,
  );
  check(
    'register: submit is enabled with the form untouched',
    await page.getByRole('button', { name: /start exploring/i }).isEnabled(),
  );

  await page.getByPlaceholder('Choose a username').fill('demo_visitor');
  await page.getByPlaceholder('your@email.com').fill('demo.visitor@example.com');
  await page.getByPlaceholder('At least 8 characters').fill('correct-horse-battery');
  await page.getByPlaceholder('Repeat your password').fill('correct-horse-battery');
  await cardShot(page, '01-register-demo-filled');

  await page.getByText(/What we record/i).click();
  await page.waitForTimeout(200);
  check(
    'register: disclosure reveals what is recorded',
    await page.getByText(/Text you type, except passwords/i).isVisible(),
  );
  await cardShot(page, '02-register-demo-disclosure-open');

  // The whole flow still submits, and it sends the acceptance.
  await page.getByRole('button', { name: /start exploring/i }).click();
  await page.getByText(/Click the link we sent you to activate it/i).waitFor();
  check('register: submits analyticsConsent=true on demo', capture.register?.analyticsConsent === true);
  await cardShot(page, '03-register-demo-submitted');

  await context.close();
}

// ── 2. Registration outside demo mode: no notice at all ──────────────────────
{
  const capture = {};
  const context = await makeContext(browser, {
    demoMode: false,
    authenticated: false,
    capture,
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/register`);
  await page.getByRole('button', { name: /request access/i }).waitFor();

  check(
    'register (non-demo): no recording notice',
    (await page.getByText(/Demo sessions are recorded/i).count()) === 0,
  );
  await cardShot(page, '04-register-non-demo');

  await page.getByPlaceholder('Choose a username').fill('alice');
  await page.getByPlaceholder('your@email.com').fill('alice@example.com');
  await page.getByPlaceholder('At least 8 characters').fill('correct-horse-battery');
  await page.getByPlaceholder('Repeat your password').fill('correct-horse-battery');
  await page.getByRole('button', { name: /request access/i }).click();
  await page.getByText(/Registration submitted/i).waitFor();
  check(
    'register (non-demo): submits analyticsConsent=false — nothing records there',
    capture.register?.analyticsConsent === false,
  );
  await context.close();
}

// ── 3. The /consent gate for an account created before the rule ──────────────
{
  const context = await makeContext(browser, { demoMode: true, analyticsConsent: false });
  const page = await context.newPage();

  // Land on a deep route: the layout must bounce it to /consent with ?next=.
  await page.goto(`${BASE}/orders`);
  await page.getByText(/Demo sessions are recorded/i).waitFor();
  check(
    'gate: a consent-less demo viewer is redirected off the app',
    new URL(page.url()).pathname === '/consent',
  );
  check(
    'gate: the requested path is carried on ?next=',
    new URL(page.url()).searchParams.get('next') === '/orders',
  );
  check(
    'gate: no sidebar or app navigation is rendered',
    (await page.getByRole('navigation', { name: 'Primary' }).count()) === 0,
  );
  check(
    'gate: states the condition rather than asking for consent',
    await page.getByText(/condition of using the demo/i).isVisible(),
  );
  check(
    'gate: offers Continue and Sign out only',
    (await page.getByRole('button').count()) === 2,
  );
  await cardShot(page, '05-consent-gate');

  await page.getByText(/What we record/i).click();
  await page.waitForTimeout(200);
  await cardShot(page, '06-consent-gate-disclosure-open');
  await context.close();
}

// ── 4. Accepting on the gate returns to the requested path ───────────────────
{
  const context = await makeContext(browser, { demoMode: true, analyticsConsent: false });
  const page = await context.newPage();
  await page.goto(`${BASE}/consent?next=%2Forders`);
  await page.getByRole('button', { name: /^Continue$/ }).waitFor();

  // Flip the stub: after the write, /auth/me reports the acceptance.
  await context.route('**/v1/auth/me', (route) => route.fulfill({ json: VIEWER(true) }));
  await page.getByRole('button', { name: /^Continue$/ }).click();
  await page.waitForURL('**/orders', { timeout: 10_000 });
  await page.setViewportSize({ width: 1280, height: 820 });
  check('gate: Continue returns to the path from ?next=', new URL(page.url()).pathname === '/orders');
  await page.getByRole('navigation', { name: 'Primary' }).waitFor();
  check(
    'gate: the app shell renders once the acceptance is recorded',
    await page.getByRole('navigation', { name: 'Primary' }).isVisible(),
  );
  await assertNoCrash(page, 'after-continue');
  await shot(page, '07-after-continue-lands-on-orders');
  await context.close();
}

// ── 5. The demo banner no longer carries an analytics opt-out ────────────────
{
  const context = await makeContext(browser, { demoMode: true, analyticsConsent: true });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto(`${BASE}/`);
  await page.getByRole('note', { name: 'Demo mode notice' }).waitFor();

  check(
    'banner: still states demo mode and read-only',
    await page.getByText(/write actions are disabled/i).isVisible(),
  );
  check(
    'banner: no "Analytics on" status',
    (await page.getByText(/Analytics on/i).count()) === 0,
  );
  await assertNoCrash(page, 'banner');
  check(
    'banner: no Disable affordance',
    (await page.getByRole('button', { name: /^Disable$/ }).count()) === 0,
  );
  await shot(page, '08-demo-banner-no-optout');
  await context.close();
}

// ── 6. Settings has no analytics tile ────────────────────────────────────────
{
  const context = await makeContext(browser, { demoMode: true, analyticsConsent: true });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/settings`);
  await page.getByRole('heading', { name: 'Settings' }).waitFor();

  check(
    'settings: no Analytics panel',
    (await page.getByRole('heading', { name: 'Analytics' }).count()) === 0,
  );
  check(
    'settings: no Privacy chip',
    (await page.locator('.toolbar-chip', { hasText: 'Privacy' }).count()) === 0,
  );
  check('settings: no consent checkbox', (await page.getByRole('checkbox').count()) === 0);
  check(
    'settings: the neighbouring panels still render',
    await page.getByRole('heading', { name: 'Environment' }).isVisible(),
  );
  await assertNoCrash(page, 'settings');
  await shot(page, '09-settings-no-analytics-tile');
  await context.close();
}

// ── 7. Both new surfaces at the three style-guide breakpoints ─────────────────
// Phone / tablet / laptop, per the widths named in the #1945 review. The
// assertion is the one a screenshot cannot make on its own: the card must not
// overflow its viewport horizontally at any of them.
const BREAKPOINTS = [
  { label: 'mobile', width: 360, height: 812 },
  { label: 'tablet', width: 768, height: 1024 },
  { label: 'laptop', width: 1440, height: 900 },
];

async function assertNoHorizontalOverflow(page, where) {
  const overflows = await page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth > doc.clientWidth + 1;
  });
  check(`${where}: no horizontal overflow`, overflows === false);
}

for (const { label, width, height } of BREAKPOINTS) {
  // Registration (anonymous, demo mode).
  const registerContext = await makeContext(browser, {
    demoMode: true,
    authenticated: false,
    viewport: { width, height },
  });
  const registerPage = await registerContext.newPage();
  await registerPage.goto(`${BASE}/register`);
  await registerPage.getByText(/Demo sessions are recorded/i).waitFor();
  await assertNoHorizontalOverflow(registerPage, `register ${label} (${width}px)`);
  await assertNoCrash(registerPage, `register ${label}`);
  await cardShot(registerPage, `10-register-demo-${label}-${width}`);
  await registerContext.close();

  // The /consent gate (authenticated, no acceptance on the account yet).
  const consentContext = await makeContext(browser, {
    demoMode: true,
    analyticsConsent: false,
    viewport: { width, height },
  });
  const consentPage = await consentContext.newPage();
  await consentPage.goto(`${BASE}/consent`);
  await consentPage.getByRole('heading', { name: /Demo sessions are recorded/i }).waitFor();
  check(
    `consent ${label}: both actions are reachable`,
    (await consentPage.getByRole('button', { name: /^Continue$/ }).isVisible()) &&
      (await consentPage.getByRole('button', { name: /sign out/i }).isVisible()),
  );
  await assertNoHorizontalOverflow(consentPage, `consent ${label} (${width}px)`);
  await assertNoCrash(consentPage, `consent ${label}`);
  await cardShot(consentPage, `11-consent-${label}-${width}`);
  await consentContext.close();
}

await browser.close();

console.log(`\nPASS ${passes.length}`);
for (const p of passes) console.log(`  ✓ ${p}`);
if (failures.length > 0) {
  console.log(`\nFAIL ${failures.length}`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`\nScreenshots in ${OUT}`);
