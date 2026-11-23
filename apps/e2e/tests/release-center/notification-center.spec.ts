/**
 * Release center - notification center, guides and link guard (#4248)
 *
 * Message notifications are published by code and kept per signed-in user in the browser, so the spec
 * seeds the browser store through `localStorage` before the app loads; nothing here needs a backend row.
 * It covers what regressed silently while the feature was built:
 *
 *   - every action of a bell message lands on a real page, never the router error page (the `/jobs` link
 *     that should have been `/jobs-logs`);
 *   - archive is one click and moves the message to the archive tab;
 *   - the tour bar is one capsule with release labels (needs a release with steps in the bell);
 *   - with the update switch off (the release-state response is rewritten) the update dialog and the
 *     release cards are gone while the bell and its messages stay.
 *
 * The arrival popup needs a live `publishNotification` call and is checked by hand against the demo
 * branch, see the PR.
 *
 * Run: pnpm --filter @openlinker/e2e exec playwright test --project=setup --project=release-center
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../../src/fixtures/test';

const NOW = Date.now();
const iso = (agoMs: number): string => new Date(NOW - agoMs).toISOString();

const SEED = [
  { itemKey: 'msg-e2e-connections', severity: 'warning', title: 'E2E token', body: 'Renew it.', createdAt: iso(2 * 3_600_000), action: { label: 'Open connections', to: '/connections' } },
  { itemKey: 'msg-e2e-listings', severity: 'success', title: 'E2E import', body: 'Done.', createdAt: iso(3 * 3_600_000), action: { label: 'Open listings', to: '/listings' } },
  { itemKey: 'msg-e2e-jobs', severity: 'error', title: 'E2E sync failed', body: 'See the logs.', createdAt: iso(4 * 3_600_000), action: { label: 'Open logs', to: '/jobs-logs' } },
  { itemKey: 'msg-e2e-orders', severity: 'info', title: 'E2E tip', body: 'A guide.', createdAt: iso(5 * 3_600_000), action: { label: 'Open orders', to: '/orders' } },
];

async function seedMessages(page: Page): Promise<void> {
  await page.addInitScript((seed: typeof SEED) => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key: string): string | null {
      return key.startsWith('ol:notifications:v1:') ? JSON.stringify(seed) : original.call(this, key);
    };
  }, SEED);
}

async function openBell(page: Page): Promise<void> {
  await page.goto('/');
  // The update window may open on a fresh stack.
  await page.keyboard.press('Escape');
  await page.locator('.release-bell').click();
  await expect(page.locator('.release-panel')).toBeVisible();
}

test.describe('release center: notification center', () => {
  test('every action of a bell message lands on a real page', async ({ page }) => {
    await seedMessages(page);
    for (const message of SEED) {
      await openBell(page);
      const row = page.locator('.msg', { hasText: message.title });
      await row.locator('.msg__action').click();
      await expect(page).toHaveURL(new RegExp(`${message.action.to}$`));
      await expect(page.getByText('Unexpected Application Error')).toHaveCount(0);
    }
  });

  test('archive is one click and moves the message to the archive tab', async ({ page }) => {
    await seedMessages(page);
    await openBell(page);
    const row = page.locator('.msg', { hasText: SEED[3].title });
    await row.locator('.msg__tools .button--icon').first().click();
    await expect(page.locator('.msg', { hasText: SEED[3].title })).toHaveCount(0);
    // Archive tab is the second tab of the panel.
    await page.locator('.release-panel__tabs .segmented-control__option').nth(1).click();
    const archived = page.locator('.msg', { hasText: SEED[3].title });
    await expect(archived).toHaveCount(1);
    // Put it back so the run leaves the user's rows as it found them.
    await archived.locator('.msg__tools .button--icon').first().click();
  });

  test('the tour bar is one capsule with release labels', async ({ page }) => {
    await seedMessages(page);
    await openBell(page);
    const start = page.locator('.release-card__actions .button').first();
    test.skip((await start.count()) === 0, 'no release card with steps on this stack');
    await start.click();
    await expect(page.locator('.tour-card')).toBeVisible();
    const releases = page.locator('.tour-card__rail .tour-card__release');
    expect(await releases.count()).toBeGreaterThan(0);
    // One bar: every step is a segment of the same rail, not a separate control row per release.
    expect(await page.locator('.tour-card__rail').count()).toBe(1);
    const labels = page.locator('.tour-card__release-label');
    if ((await labels.count()) > 0) {
      await labels.first().hover();
      await expect(page.locator('.tour-card__tip')).toBeVisible();
    }
  });

  test('with the update switch off the bell and messages stay, release cards go', async ({ page }) => {
    await seedMessages(page);
    await page.route(/release-state$/, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      const json = (await response.json()) as Record<string, unknown>;
      await route.fulfill({ response, json: { ...json, enabled: false, cursor: null, installation: [] } });
    });
    await page.goto('/');
    await expect(page.locator('.release-dialog')).toHaveCount(0);
    await page.locator('.release-bell').click();
    await expect(page.locator('.release-panel')).toBeVisible();
    await expect(page.locator('.msg')).toHaveCount(SEED.length);
    await expect(page.locator('.release-card')).toHaveCount(0);
  });
});
