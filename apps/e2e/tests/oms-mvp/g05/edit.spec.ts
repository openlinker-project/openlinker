/**
 * G05 golden path 3 - edit address and quantity, discount on a paid order (#3546)
 *
 * Editing is checked against a REAL ingested Allegro order, located by
 * `support/oms-mvp-g05-orders.ts` (a sandbox order in the right state cannot be
 * manufactured deterministically); each case skips with a named reason when the
 * stack has none. MUTATING: the located order's address and quantities are
 * really edited in OpenLinker (the channel itself is never written).
 *
 * @module tests/oms-mvp/g05
 */
import { test, expect } from '../../../src/fixtures/test';
import { attachMockupComparison } from '../../../src/support/oms-mvp-g05-compare';
import { G05_MOCKUP_FILES } from '../../../src/pages/oms-mvp-g05-mockup.page';
import {
  externalOrderIdOf,
  findAllegroOrder,
  lowerableLineQuantity,
} from '../../../src/support/oms-mvp-g05-orders';

test.describe('G05 golden path 3 - edit (#3546)', () => {
  test('should read "Edited in OpenLinker" and survive a re-poll when the address and a quantity are edited', async ({
    page,
    api,
    world,
    jobs,
  }, testInfo) => {
    const order = await findAllegroOrder(api, world, 'unshipped');
    test.skip(!order, 'No unshipped, uninvoiced, not-cancelled Allegro order is ingested on this stack.');
    const quantity = lowerableLineQuantity(order!);
    test.skip(quantity === null, 'The located order has no line with a quantity of at least 2 to lower.');

    await page.goto(`/orders/${order!.internalOrderId}`);
    const editButton = page.getByTestId('order-edit-button');
    test.skip(
      (await editButton.count()) === 0 || (await editButton.isDisabled()),
      'The edit action is not offered for the located order (packed or terminal).',
    );
    await editButton.click();
    await expect(page.getByTestId('order-edit-dialog')).toBeVisible();
    test.skip(
      (await page.getByTestId('order-edit-address').count()) === 0,
      'The address section is locked for the located order.',
    );

    const street = `E2E G05 Street ${Date.now()}`;
    await attachMockupComparison(page, testInfo, {
      mockupFile: G05_MOCKUP_FILES.m1,
      mockupState: 'order',
      label: 'M1 order',
    });
    await page.getByTestId('order-edit-street').fill(street);
    await page.getByTestId('order-edit-line-quantity').first().fill(String(quantity! - 1));
    await attachMockupComparison(page, testInfo, {
      mockupFile: G05_MOCKUP_FILES.m1,
      mockupState: 'edit-form',
      label: 'M1 edit-form',
    });
    await page.getByTestId('order-edit-review-button').click();

    await expect(page.getByTestId('order-edit-diff')).toBeVisible();
    await expect(page.getByTestId('order-edit-impact')).toBeVisible();
    await attachMockupComparison(page, testInfo, {
      mockupFile: G05_MOCKUP_FILES.m1,
      mockupState: 'edit-review',
      label: 'M1 edit-review',
    });
    await page.getByTestId('order-edit-save').click();

    await expect(page.getByTestId('order-edit-saved-badge').first()).toBeVisible();
    await expect(page.getByTestId('order-edit-notice')).toBeVisible();
    await attachMockupComparison(page, testInfo, {
      mockupFile: G05_MOCKUP_FILES.m1,
      mockupState: 'edit-saved',
      label: 'M1 edit-saved',
    });

    // A re-poll of the source order must keep the edits.
    const externalOrderId = externalOrderIdOf(order!);
    test.skip(externalOrderId === null, 'The located order carries no source event id to re-poll by.');
    await jobs.triggerAndWait({
      connectionId: order!.sourceConnectionId,
      jobType: 'marketplace.order.sync',
      payload: {
        schemaVersion: 1,
        externalOrderId: externalOrderId!,
        sourceEventId: `${externalOrderId}:e2e-g05-repoll:${Date.now()}`,
      },
    });

    await page.reload();
    await expect(page.getByTestId('order-edit-saved-badge').first()).toBeVisible();
    await expect(page.getByTestId('order-edit-notice')).toBeVisible();
    await expect(page.getByText(street).first()).toBeVisible();
  });

  test('should show the refund intent when a discount is applied to a paid order', async ({
    page,
    api,
    world,
  }) => {
    const order = await findAllegroOrder(api, world, 'unshipped');
    test.skip(!order, 'No unshipped, uninvoiced, not-cancelled Allegro order is ingested on this stack.');

    await page.goto(`/orders/${order!.internalOrderId}`);
    const editButton = page.getByTestId('order-edit-button');
    test.skip(
      (await editButton.count()) === 0 || (await editButton.isDisabled()),
      'The edit action is not offered for the located order (packed or terminal).',
    );
    await editButton.click();
    await expect(page.getByTestId('order-edit-dialog')).toBeVisible();
    test.skip(
      (await page.getByTestId('order-edit-paid-note').filter({ hasText: 'The buyer paid' }).count()) === 0,
      'The located order has no recorded channel payment, so a discount produces no refund intent.',
    );
    test.skip(
      (await page.getByTestId('order-edit-discount').count()) === 0,
      'The discount section is locked for the located order.',
    );

    await page.getByTestId('order-edit-discount-amount').fill('1.00');
    await page.getByTestId('order-edit-review-button').click();
    await expect(page.getByTestId('order-edit-diff')).toBeVisible();
    await page.getByTestId('order-edit-save').click();

    await expect(page.getByTestId('order-edit-refund-pending')).toBeVisible();
    await expect(page.getByTestId('order-edit-confirm-refund')).toBeVisible();
  });
});
