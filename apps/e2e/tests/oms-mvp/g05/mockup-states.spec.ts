/**
 * G05 live mockup states (#3546)
 *
 * The acceptance criterion is that the live app reaches EVERY state of the M1
 * and M2 mockups using the mockup's own `data-testid` values. The golden-path
 * specs reach the main line; this file reaches the states they do not:
 *
 *   M2 `none`, `long`, `list`, `multi`   and   M1 `cancel-label`, `edit-blocked`
 *
 * Each state is seeded straight into Postgres (`support/oms-mvp-g05-seed.ts`,
 * namespaced ids, deleted and re-created per call) because a sandbox cannot
 * produce a note-less order, a 563-character note, a second parcel or a label
 * the carrier refuses to void on demand. After the live assertions, the live
 * screenshot and the mockup screenshot of the same state are attached to the
 * report. No pixel diff is asserted.
 *
 * @module tests/oms-mvp/g05
 */
import { test, expect } from '../../../src/fixtures/test';
import { readSystemConfig } from '../../../src/support/access-control';
import { provisionPacker, seedPackerBrowserSession } from '../../../src/support/provision-packer';
import { clearBenchSeed } from '../../../src/support/bench-seed';
import { attachMockupComparison } from '../../../src/support/oms-mvp-g05-compare';
import { G05_MOCKUP_FILES } from '../../../src/pages/oms-mvp-g05-mockup.page';
import {
  clearG05Seed,
  seedBenchOrderWithTwoParcels,
  seedBuyerNoteOrders,
  seedOrderWithGeneratedLabel,
  seedOrderWithLongBuyerNote,
  seedOrderWithoutBuyerNote,
  seedPackedOrder,
} from '../../../src/support/oms-mvp-g05-seed';

test.describe('G05 live mockup states (#3546)', () => {
  test.afterAll(async () => {
    await clearG05Seed();
    await clearBenchSeed();
  });

  test('should render no buyer note block when the order has no note (M2 none)', async ({
    page,
  }, testInfo) => {
    const orderId = await seedOrderWithoutBuyerNote();

    await page.goto(`/orders/${orderId}`);
    await expect(page.getByRole('heading', { name: 'Order detail' })).toBeVisible();
    await expect(page.getByTestId('order-buyer-note')).toHaveCount(0);
    await expect(page.getByTestId('order-buyer-note-text')).toHaveCount(0);

    await attachMockupComparison(page, testInfo, {
      mockupFile: G05_MOCKUP_FILES.m2,
      mockupState: 'none',
      label: 'M2 none',
    });
  });

  test('should clamp a long buyer note and expand it on demand (M2 long)', async ({ page }, testInfo) => {
    const orderId = await seedOrderWithLongBuyerNote();

    await page.goto(`/orders/${orderId}`);
    const text = page.getByTestId('order-buyer-note-text');
    await expect(page.getByTestId('order-buyer-note')).toBeVisible();
    await expect(page.getByTestId('order-buyer-note-meta')).toBeVisible();
    await expect(page.getByTestId('order-buyer-note-copy')).toBeVisible();
    await expect(text).toHaveAttribute('data-clamped', 'true');
    const expand = page.getByTestId('order-buyer-note-expand');
    await expect(expand).toBeVisible();
    await expect(expand).toHaveAttribute('aria-expanded', 'false');

    await attachMockupComparison(page, testInfo, {
      mockupFile: G05_MOCKUP_FILES.m2,
      mockupState: 'long',
      label: 'M2 long',
    });

    await expand.click();
    await expect(expand).toHaveAttribute('aria-expanded', 'true');
    await expect(text).toHaveAttribute('data-clamped', 'false');
  });

  test('should show the note hint, the filter chip and the row detail note on the orders list (M2 list)', async ({
    page,
  }, testInfo) => {
    const [orderId] = await seedBuyerNoteOrders();

    await page.goto('/orders');
    await expect(page.getByTestId('orders-filter-buyer-note')).toBeVisible();
    await page.getByTestId('orders-filter-buyer-note').click();

    const row = page.getByRole('row').filter({ has: page.getByLabel(`Select ${orderId}`) });
    await expect(row).toBeVisible();
    await expect(row.getByTestId('order-buyer-note-hint')).toBeVisible();

    await row.getByRole('button', { name: `Expand details for order ${orderId}` }).click();
    await expect(page.getByTestId('order-row-buyer-note').first()).toBeVisible();
    await expect(page.getByTestId('order-row-buyer-note-text').first()).toBeVisible();

    await attachMockupComparison(page, testInfo, {
      mockupFile: G05_MOCKUP_FILES.m2,
      mockupState: 'list',
      label: 'M2 list',
    });
  });

  test('should show the other parcel reading on the bench when an order has two parcels (M2 multi)', async ({
    page,
    api,
    env,
  }, testInfo) => {
    const config = await readSystemConfig(env);
    test.skip(
      config.demoMode,
      'bench packer provisioning needs an admin-approvable registration, unavailable in demo mode (#1624)',
    );
    const packer = await provisionPacker(env, api);
    test.skip(packer === null, 'no packer available - registration disabled or rate-limited on this stack');

    const { seed } = await seedBenchOrderWithTwoParcels();

    await seedPackerBrowserSession(page.context(), env, packer!.creds);
    await page.goto('/bench');
    await expect(page.getByTestId('bench-work-row-buyer-note').first()).toBeVisible();
    await page
      .locator('[data-testid="bench-work-row"]')
      .filter({ hasText: seed.orderReference })
      .getByRole('button', { name: 'Open parcel' })
      .click();

    await expect(page.getByTestId('bench-buyer-note')).toBeVisible();
    await expect(page.getByTestId('bench-buyer-note-text')).toBeVisible();
    await expect(page.getByTestId('bench-buyer-note-others')).toBeVisible();
    await expect(page.getByTestId('bench-buyer-note-acknowledge')).toBeVisible();

    await attachMockupComparison(page, testInfo, {
      mockupFile: G05_MOCKUP_FILES.m2,
      mockupState: 'multi',
      label: 'M2 multi',
    });
  });

  test('should refuse a cancel and point at the shipment when the label cannot be voided (M1 cancel-label)', async ({
    page,
  }, testInfo) => {
    const orderId = await seedOrderWithGeneratedLabel();

    await page.goto(`/orders/${orderId}`);
    await page.getByTestId('order-cancel-button').click();
    await expect(page.getByTestId('order-cancel-dialog')).toBeVisible();
    await page.getByTestId('order-cancel-reason').selectOption('buyer-request');
    await page.getByTestId('order-cancel-submit').click();

    await expect(page.getByTestId('order-cancel-label-refusal')).toBeVisible();
    await expect(page.getByTestId('order-cancel-label-refusal')).not.toBeEmpty();
    await expect(page.getByTestId('order-cancel-label-go-to-shipment')).toBeVisible();
    await expect(page.getByTestId('order-cancel-keep')).toBeVisible();

    await attachMockupComparison(page, testInfo, {
      mockupFile: G05_MOCKUP_FILES.m1,
      mockupState: 'cancel-label',
      label: 'M1 cancel-label',
    });
  });

  test('should show the blocked notice and lock the sections when a packed order is edited (M1 edit-blocked)', async ({
    page,
  }, testInfo) => {
    const orderId = await seedPackedOrder();

    await page.goto(`/orders/${orderId}`);
    await page.getByTestId('order-edit-button').click();
    await expect(page.getByTestId('order-edit-dialog')).toBeVisible();
    await expect(page.getByTestId('order-edit-blocked')).toBeVisible();
    await expect(page.getByTestId('order-edit-blocked-steps')).toBeVisible();
    await expect(page.getByTestId('order-edit-locked-lines')).toBeVisible();
    await expect(page.getByTestId('order-edit-locked-discount')).toBeVisible();
    await expect(page.getByTestId('order-edit-review-button')).toBeDisabled();

    await attachMockupComparison(page, testInfo, {
      mockupFile: G05_MOCKUP_FILES.m1,
      mockupState: 'edit-blocked',
      label: 'M1 edit-blocked',
    });
  });
});
