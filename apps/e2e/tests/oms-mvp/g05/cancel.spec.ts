/**
 * G05 golden path 2 - cancel and refused cancel (#3546)
 *
 * Cancelling is a real channel act, so each case LOCATES an already-ingested
 * Allegro order in the right state (`support/oms-mvp-g05-orders.ts`) and skips
 * with a named reason when the stack has none. MUTATING: a located order is
 * actually cancelled on the channel.
 *
 *   - unshipped, uninvoiced: passes through the pending notice and ends cancelled
 *   - invoiced: cancelled with a reason, and a correction proposal is opened
 *   - shipped: refused, showing the server's own reason
 *
 * @module tests/oms-mvp/g05
 */
import { test, expect } from '../../../src/fixtures/test';
import { attachMockupComparison } from '../../../src/support/oms-mvp-g05-compare';
import { G05_MOCKUP_FILES } from '../../../src/pages/oms-mvp-g05-mockup.page';
import { findAllegroOrder } from '../../../src/support/oms-mvp-g05-orders';

test.describe('G05 golden path 2 - cancel (#3546)', () => {
  test('should end cancelled after the pending notice when an unshipped uninvoiced order is cancelled', async ({
    page,
    api,
    world,
    poll,
  }, testInfo) => {
    const order = await findAllegroOrder(api, world, 'unshipped');
    test.skip(!order, 'No unshipped, uninvoiced, not-cancelled Allegro order is ingested on this stack.');

    await page.goto(`/orders/${order!.internalOrderId}`);
    await attachMockupComparison(page, testInfo, {
      mockupFile: G05_MOCKUP_FILES.m1,
      mockupState: 'order',
      label: 'M1 order',
    });
    await page.getByTestId('order-cancel-button').click();
    const dialog = page.getByTestId('order-cancel-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('order-cancel-impact')).toBeVisible();
    await attachMockupComparison(page, testInfo, {
      mockupFile: G05_MOCKUP_FILES.m1,
      mockupState: 'cancel-confirm',
      label: 'M1 cancel-confirm',
    });

    await page.getByTestId('order-cancel-reason').selectOption('buyer-request');
    await page.getByTestId('order-cancel-submit').click();

    // "Change pending" is the channel not having answered yet; a channel that
    // answers within the request goes straight to the result notice.
    await expect(
      page.getByTestId('order-cancel-progress').or(page.getByTestId('order-cancel-done')),
    ).toBeVisible();
    const stillPending = await page.getByTestId('order-cancel-progress').isVisible();
    await attachMockupComparison(page, testInfo, {
      mockupFile: G05_MOCKUP_FILES.m1,
      mockupState: stillPending ? 'cancel-progress' : 'cancel-done',
      label: stillPending ? 'M1 cancel-progress' : 'M1 cancel-done (answered in request)',
    });

    await poll.until(
      () => api.orders.getById(order!.internalOrderId),
      (record) => Boolean(record.cancelledAt),
      { message: 'the order to end cancelled', timeoutMs: 120_000 },
    );
    await page.reload();
    await expect(page.getByTestId('order-cancel-button')).toHaveCount(0);
  });

  test('should open a correction proposal when an invoiced order is cancelled with a reason', async ({
    page,
    api,
    world,
    poll,
  }, testInfo) => {
    const order = await findAllegroOrder(api, world, 'invoiced');
    test.skip(!order, 'No invoiced, unshipped, not-cancelled Allegro order is ingested on this stack.');

    await page.goto(`/orders/${order!.internalOrderId}`);
    await page.getByTestId('order-cancel-button').click();
    await expect(page.getByTestId('order-cancel-dialog')).toBeVisible();
    await expect(page.getByTestId('order-cancel-impact-invoice')).toBeVisible();

    await page.getByTestId('order-cancel-reason').selectOption('out-of-stock');
    await page.getByTestId('order-cancel-note').fill('E2E G05 invoiced cancel');
    await page.getByTestId('order-cancel-submit').click();

    await poll.until(
      () => api.orders.getById(order!.internalOrderId),
      (record) => Boolean(record.cancelledAt),
      { message: 'the invoiced order to end cancelled', timeoutMs: 120_000 },
    );
    await page.reload();
    await expect(page.getByTestId('order-cancel-done-correction')).toBeVisible();
    await expect(page.getByTestId('order-cancel-review-correction')).toBeVisible();
    await attachMockupComparison(page, testInfo, {
      mockupFile: G05_MOCKUP_FILES.m1,
      mockupState: 'cancel-done',
      label: 'M1 cancel-done',
    });
  });

  test('should refuse with the server reason when a shipped order is cancelled', async ({
    page,
    api,
    world,
  }, testInfo) => {
    const order = await findAllegroOrder(api, world, 'shipped');
    test.skip(!order, 'No dispatched or delivered, not-cancelled Allegro order is ingested on this stack.');

    await page.goto(`/orders/${order!.internalOrderId}`);
    const cancel = page.getByTestId('order-cancel-button');
    test.skip(
      (await cancel.count()) === 0,
      'The cancel action is not offered for this shipped order (terminal phase), so the server refusal cannot be reached from the UI.',
    );
    await cancel.click();
    await page.getByTestId('order-cancel-reason').selectOption('buyer-request');
    await page.getByTestId('order-cancel-submit').click();

    const refusal = page.getByTestId('order-cancel-shipped-refusal');
    await expect(refusal).toBeVisible();
    await expect(refusal).not.toBeEmpty();
    await attachMockupComparison(page, testInfo, {
      mockupFile: G05_MOCKUP_FILES.m1,
      mockupState: 'cancel-shipped',
      label: 'M1 cancel-shipped',
    });
    expect((await api.orders.getById(order!.internalOrderId)).cancelledAt ?? null).toBeNull();
  });
});
