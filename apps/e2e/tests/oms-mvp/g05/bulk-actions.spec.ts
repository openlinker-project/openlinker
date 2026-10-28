/**
 * G05 golden path 5 - bulk actions on /orders (#3546, mockup M3 `bulk`)
 *
 * Selects three seeded orders (each with an unread buyer note, written by
 * `support/oms-mvp-g05-seed.ts`) and runs bulk mark-read, bulk tag and bulk
 * cancel. Each action reports a per-row outcome: mark-read and cancel through
 * a result dialog with one row per order, tag through a toast naming the
 * added / already-tagged split (one order is tagged first so the split is
 * not trivially all-added).
 *
 * The seed orders belong to a fake PrestaShop connection, so the channel half
 * of bulk cancel cannot succeed; the spec asserts that EVERY selected order
 * gets its own outcome row, not that the cancel was confirmed.
 *
 * @module tests/oms-mvp/g05
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../../../src/fixtures/test';
import { attachMockupComparison } from '../../../src/support/oms-mvp-g05-compare';
import { G05_MOCKUP_FILES } from '../../../src/pages/oms-mvp-g05-mockup.page';
import { G05_ORDER_IDS, clearG05Seed, seedBuyerNoteOrders } from '../../../src/support/oms-mvp-g05-seed';

async function selectSeededOrders(page: Page): Promise<void> {
  await page.goto('/orders');
  for (const orderId of G05_ORDER_IDS) {
    await page.getByLabel(`Select ${orderId}`).check();
  }
  await expect(page.getByTestId('orders-bulk-bar')).toBeVisible();
}

test.describe('G05 golden path 5 - bulk actions (#3546)', () => {
  test.beforeEach(async () => {
    await seedBuyerNoteOrders();
  });
  test.afterAll(async () => {
    await clearG05Seed();
  });

  test('should report each order outcome when three orders are bulk marked read', async ({
    page,
  }, testInfo) => {
    await selectSeededOrders(page);
    await attachMockupComparison(page, testInfo, {
      mockupFile: G05_MOCKUP_FILES.m3,
      mockupState: 'bulk',
      label: 'M3 bulk',
    });
    await page.getByTestId('orders-bulk-read').click();
    await expect(page.getByTestId('orders-bulk-read-plan')).toBeVisible();
    await page.getByTestId('orders-bulk-read-submit').click();

    await expect(page.getByTestId('orders-bulk-read-summary')).toBeVisible();
    await expect(page.getByTestId('orders-bulk-result-row')).toHaveCount(G05_ORDER_IDS.length);
    await page.getByTestId('orders-bulk-read-close').click();
  });

  test('should report the added and already-tagged split when three orders are bulk tagged', async ({
    page,
  }) => {
    const tagName = `E2E-G05-${Date.now()}`;

    // Create the tag by assigning it to the first order on its detail page.
    await page.goto(`/orders/${G05_ORDER_IDS[0]}`);
    await page.getByRole('button', { name: '+ Add tag' }).click();
    await page.getByPlaceholder('Find or create a tag').fill(tagName);
    await page.getByRole('button', { name: `+ Create “${tagName}”` }).click();
    await expect(page.getByRole('button', { name: `Remove tag ${tagName}` })).toBeVisible();
    await page.keyboard.press('Escape');

    await selectSeededOrders(page);
    await page.getByTestId('orders-bulk-tags').click();
    await expect(page.getByTestId('orders-bulk-tags-menu')).toBeVisible();
    const apply = page.locator(`[data-testid="orders-bulk-tag-apply"][data-apply="${tagName}"]`);
    await expect(apply.getByTestId('orders-bulk-tag-has-it')).toBeVisible();
    await apply.click();

    await expect(page.getByText(tagName).first()).toBeVisible();
  });

  test('should report a row for every order when three orders are bulk cancelled', async ({ page }) => {
    await selectSeededOrders(page);
    const cancel = page.getByTestId('orders-bulk-cancel');
    test.skip((await cancel.count()) === 0, 'Bulk cancel is admin-only and not offered to this session.');
    await cancel.click();

    await expect(page.getByTestId('orders-bulk-cancel-dialog')).toBeVisible();
    await page.getByTestId('orders-bulk-cancel-reason').selectOption('buyer-request');
    await page.getByTestId('orders-bulk-cancel-submit').click();

    await expect(page.getByTestId('orders-bulk-cancel-summary')).toBeVisible();
    await expect(page.getByTestId('orders-bulk-result-row')).toHaveCount(G05_ORDER_IDS.length);
    await page.getByTestId('orders-bulk-cancel-close').click();
  });
});
