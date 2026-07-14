/**
 * Access control: UI reflection
 *
 * Asserts the FE reflects the caller's permissions, not just the backend:
 *   - Admin session: the `Administration` and `AI` nav groups are present.
 *   - Viewer session: those groups are HIDDEN in normal mode, or rendered
 *     DISABLED + locked in demo mode (branching on `GET /system/config`).
 *   - Direct navigation to `/users` as a viewer RENDERS the page and surfaces
 *     the API 403 as an error state — the URL stays on `/users` (no redirect
 *     to /login), proving there is no client-side role route guard.
 *
 * The admin case uses the shared admin session (storageState + browserAuth).
 * The viewer case builds a fresh browser context and seeds a viewer session so
 * the admin storageState never leaks in; it skips-with-annotation when a viewer
 * can't be provisioned.
 *
 * @module tests/access-control
 */
import { test, expect } from '../../src/fixtures/test';
import { provisionViewer, seedBrowserSession } from '../../src/support/access-control';

const ADMIN_NAV_LOCK_TITLE = 'Requires an administrator role.';

test.describe('access-control: UI reflection', () => {
  test('admin sees the Administration and AI nav groups', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Primary', exact: true });
    await expect(nav.getByText('Administration', { exact: true })).toBeVisible();
    await expect(nav.getByText('AI', { exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Users', exact: true })).toBeVisible();
  });

  test('viewer nav reflects the mode and /users renders a 403 error state', async ({
    api,
    env,
    browser,
  }, testInfo) => {
    const config = await api.system.config();
    const viewer = await provisionViewer(env, api);
    test.skip(!viewer, 'registration disabled or rate-limited — cannot provision a viewer');
    testInfo.annotations.push({
      type: 'access-control',
      description: `viewer ${viewer!.creds.username}, demoMode=${config.demoMode}`,
    });

    const context = await browser.newContext({ baseURL: env.webUrl });
    try {
      await seedBrowserSession(context, env, viewer!.creds);
      const page = await context.newPage();
      await page.goto('/');

      const nav = page.getByRole('navigation', { name: 'Primary', exact: true });
      await expect(nav).toBeVisible();

      if (config.demoMode) {
        // Demo: admin groups are visible but disabled + locked (discoverability).
        await expect(nav.getByText('Administration', { exact: true })).toBeVisible();
        const lockedUsers = nav.locator('.shell-nav__link--disabled', { hasText: 'Users' });
        await expect(lockedUsers).toBeVisible();
        await expect(lockedUsers).toHaveAttribute('title', ADMIN_NAV_LOCK_TITLE);
      } else {
        // Normal: admin groups are filtered out entirely for a non-admin.
        await expect(nav.getByText('Administration', { exact: true })).toHaveCount(0);
        await expect(nav.getByRole('link', { name: 'Users', exact: true })).toHaveCount(0);
      }

      // Direct nav to an admin route: the page renders and surfaces the API 403
      // as an error state — no client-side redirect to /login.
      await page.goto('/users');
      await expect(page).toHaveURL(/\/users(?:[/?#]|$)/);
      await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
      await expect(page.getByText('Unable to load users')).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
