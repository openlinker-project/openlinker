/**
 * Access control: demo mode
 *
 * Demo mode is intentionally minimal. The single machine-readable signal is the
 * public `GET /system/config -> { demoMode }`; there is NO backend write-block
 * keyed on demo mode — "read-only" is a side effect of RBAC (demo
 * self-registration yields a `viewer`, and every write endpoint is `@Roles`-
 * gated). That backend "write blocked because demo" behaviour is therefore
 * asserted here as N/A (see the API test), not tested as if it existed. The
 * demo-connection seed (#1127) and the backend AI-reject in demo (#1404) do not
 * exist either and are out of scope.
 *
 * These specs are self-configuring: they read `GET /system/config` and assert
 * the correct behaviour for whichever mode the stack is in, skipping the
 * mode-specific viewer case with an annotation when a viewer can't be
 * provisioned.
 *
 * @module tests/access-control
 */
import { test, expect } from '../../src/fixtures/test';
import {
  provisionViewer,
  seedBrowserSession,
  sweepProvisionedAccounts,
} from '../../src/support/access-control';
import { gotoWhenAppMounted } from '../../src/support/navigation';

test.describe('access-control: demo mode', () => {
  // `provisionViewer` mints a real account per call - delete it on the way out.
  test.afterAll(async ({ api }) => {
    await sweepProvisionedAccounts(api);
  });

  test('GET /system/config exposes a boolean demoMode flag', async ({ api }) => {
    const config = await api.system.config();
    expect(typeof config.demoMode).toBe('boolean');
    // N/A by design: there is no backend endpoint that rejects a write purely
    // because demo mode is on — RBAC is the boundary, so nothing to assert here.
  });

  test('login page shows the register link only in demo mode', async ({ api, env, browser }) => {
    const config = await api.system.config();
    // Guest view: a fresh context (no admin storageState) so /login renders the
    // guest form instead of redirecting an authenticated session to the shell.
    const context = await browser.newContext({ baseURL: env.webUrl });
    try {
      // OBSERVED, MECHANISM UNEXPLAINED. `browser.newContext()` is documented as
      // storage-isolated from every other context, yet on this stack it was
      // reproduced 5/5 handing back a context already carrying the OTHER (admin)
      // context's `ol_refresh`/`ol_csrf` cookies before any navigation, with
      // GuestLayout then redirecting the "guest" page straight to the
      // authenticated shell (`session.status === 'authenticated'`).
      //
      // An earlier version of this comment blamed Playwright's
      // `_defaultContextOptions` leaking the storageState seed onto the browser
      // type. That is NOT the mechanism: in the pinned Playwright (1.61.1)
      // `_combinedContextOptions` is passed only to the `context` fixture's
      // `_contextFactory`, and `_defaultContextOptions` does not exist on the
      // browser type at all. Do not build on the old explanation - the root
      // cause is still open (the `gotoWhenAppMounted` hardening landed in the
      // same commit and is a plausible confound).
      //
      // `clearCookies()` is a correct fix for the SYMPTOM regardless of cause:
      // it makes the context match what this test needs - genuinely logged out.
      await context.clearCookies();
      const page = await context.newPage();
      // First navigation of this context against a possibly-cold web container:
      // wait for the SPA to be interactive before asserting (issue #1513).
      const heading = page.getByRole('heading', { name: 'Sign in to your account' });
      await gotoWhenAppMounted(page, '/login', { readyLocator: heading });
      await expect(heading).toBeVisible();

      // Resilient to copy tweaks (the trailing arrow, casing, whitespace) by
      // OR-ing the accessible name against the stable /register anchor.
      const registerLink = page
        .getByRole('link', { name: /create a free demo account/i })
        .or(page.locator('a[href="/register"].guest-form__demo-register'));
      if (config.demoMode) {
        await expect(registerLink).toBeVisible();
        await expect(registerLink).toHaveAttribute('href', '/register');
      } else {
        await expect(registerLink).toHaveCount(0);
      }
    } finally {
      await context.close();
    }
  });

  test('viewer sees the demo banner when demo mode is on', async ({
    api,
    env,
    browser,
  }, testInfo) => {
    const config = await api.system.config();
    test.skip(!config.demoMode, 'demo mode is off — the demo banner is not rendered');

    const viewer = await provisionViewer(env, api);
    test.skip(
      !viewer,
      'no viewer available — registration disabled/rate-limited, or the demo signup is ' +
        'awaiting email confirmation (#1624). Set E2E_VIEWER_USER/E2E_VIEWER_PASS to a ' +
        'pre-seeded active viewer to run this case.',
    );
    testInfo.annotations.push({
      type: 'access-control',
      description: `provisioned viewer ${viewer!.creds.username}`,
    });

    const context = await browser.newContext({ baseURL: env.webUrl });
    try {
      // Same unexplained cross-context cookie carry-over as the guest case
      // above. This site is only ACCIDENTALLY safe: `seedBrowserSession`
      // immediately overwrites the jar with the viewer's session. On a stack
      // with `OL_COOKIE_DOMAIN` set, the login response sets a Domain cookie
      // that does NOT replace a leaked host-only copy of the same name, and the
      // browser then sends both - the RFC 6265 duplicate-cookie hazard
      // `auth.cookies.ts` documents from #748, with the admin's session
      // potentially winning. Clear first so the seed is the only session here.
      await context.clearCookies();
      await seedBrowserSession(context, env, viewer!.creds);
      const page = await context.newPage();
      // First navigation of this context against a possibly-cold web container.
      const banner = page.getByRole('note', { name: 'Demo mode notice' });
      await gotoWhenAppMounted(page, '/', { readyLocator: banner });
      await expect(banner).toBeVisible();
      await expect(banner).toContainText(/write actions are\s+disabled/i);
    } finally {
      await context.close();
    }
  });
});
