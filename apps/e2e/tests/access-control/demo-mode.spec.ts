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
import { provisionViewer, seedBrowserSession } from '../../src/support/access-control';

test.describe('access-control: demo mode', () => {
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
      const page = await context.newPage();
      await page.goto('/login');
      await expect(
        page.getByRole('heading', { name: 'Sign in to your account' }),
      ).toBeVisible();

      const registerLink = page.getByRole('link', { name: /create a free demo account/i });
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

  test('viewer sees the demo banner when demo mode is on', async ({ api, env, browser }, testInfo) => {
    const config = await api.system.config();
    test.skip(!config.demoMode, 'demo mode is off — the demo banner is not rendered');

    const viewer = await provisionViewer(env, api);
    test.skip(!viewer, 'registration disabled or rate-limited — cannot provision a viewer');
    testInfo.annotations.push({
      type: 'access-control',
      description: `provisioned viewer ${viewer!.creds.username}`,
    });

    const context = await browser.newContext({ baseURL: env.webUrl });
    try {
      await seedBrowserSession(context, env, viewer!.creds);
      const page = await context.newPage();
      await page.goto('/');
      const banner = page.getByRole('note', { name: 'Demo mode notice' });
      await expect(banner).toBeVisible();
      await expect(banner).toContainText(/write actions are\s+disabled/i);
    } finally {
      await context.close();
    }
  });
});
