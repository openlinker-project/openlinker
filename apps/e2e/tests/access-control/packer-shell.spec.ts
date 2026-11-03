/**
 * Access control: a packer never sees the app shell (#3096, F-9)
 *
 * A packer's whole job is the pack bench. The app layout derives
 * "bench-only" from the session's permissions (`bench:write` without
 * `orders:read`) and sends such a session to `/bench` before it renders any
 * shell — so no app address shows a packer the admin navigation, even for the
 * frame the system config takes to load.
 *
 * @module tests/access-control
 */
import { test, expect } from '../../src/fixtures/test';
import { readSystemConfig } from '../../src/support/access-control';
import { provisionPacker, seedPackerBrowserSession } from '../../src/support/provision-packer';

test.describe('packer shell (#3096, F-9)', () => {
  test('every app address sends a packer to the bench, with no app navigation', async ({ page, api, env }) => {
    const config = await readSystemConfig(env);
    test.skip(config.demoMode, 'packer provisioning needs an admin-approvable registration, unavailable in demo mode (#1624)');

    const packer = await provisionPacker(env, api);
    test.skip(!packer, 'no packer available — registration disabled or rate-limited on this stack');

    await seedPackerBrowserSession(page.context(), env, packer!.creds);

    for (const path of ['/', '/orders', '/fulfillment', '/fulfillment/works/does-not-matter']) {
      await test.step(path, async () => {
        await page.goto(path);
        await expect(page).toHaveURL(/\/bench(?:[?#]|$)/);
        await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(0);
      });
    }
  });
});
