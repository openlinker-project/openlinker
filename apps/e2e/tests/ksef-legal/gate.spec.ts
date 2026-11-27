/**
 * ksef-legal: the live-order gate (DEF-26)
 *
 * A cancelled or fully refunded order is not invoiced by default, but a person
 * issuing by hand may know better: the manual issue answers 409 naming a
 * warning code, and the order panel offers to go ahead anyway. An order that
 * already has a document and is THEN cancelled or refunded is flagged, never
 * blocked.
 *
 * The automatic path (`invoicing.issue` skipping a cancelled order) needs a
 * routed auto-issue connection this stack does not configure; it is covered by
 * the worker handler's unit spec and annotated here rather than faked.
 *
 * @module tests/ksef-legal
 */
import { test, expect } from '../../src/fixtures/test';
import {
  buildPrestashopWebserviceClient,
  resolvePrestashopStore,
} from '../../src/support/order-synthesis';
import { shot } from '../../src/support/shot';
import { failureOf, issueAndClear, requireKsef, ksefOrder } from './ksef-legal.helpers';

test.describe('ksef-legal: live-order gate (DEF-26)', () => {
  test('a cancelled order asks before a manual invoice, and issues once confirmed', async ({
    api,
    world,
    jobs,
    poll,
    pages,
    page,
  }, testInfo) => {
    const ksef = requireKsef(world);
    testInfo.annotations.push({
      type: 'unit-only',
      description:
        'the automatic invoicing.issue skip is covered by invoicing-issue.handler.spec.ts',
    });
    const ps = buildPrestashopWebserviceClient(world)!;
    const store = resolvePrestashopStore(world)!;

    const synthesized = await ksefOrder({ api, world, jobs, poll });
    await ps.setOrderState(
      synthesized.externalOrderId,
      process.env.E2E_PS_CANCELED_STATE_ID ?? '6'
    );
    const resync = jobs.retriggerDirectOrderSync(store.id, synthesized.externalOrderId);
    const cancelled = await poll.until(
      async () => {
        await resync();
        return api.orders.getById(synthesized.order.internalOrderId);
      },
      (o) => (o.cancelledAt ?? null) !== null,
      { message: 'OpenLinker to see the order as cancelled', timeoutMs: 180_000, intervalMs: 5_000 }
    );
    expect(cancelled.cancelledAt ?? null).not.toBeNull();
    // Let the cancellation re-sync finish rewriting the record: an issue that
    // lands mid-rewrite reads it as not ready (seen live as a 422 "buyer
    // details are unavailable"), which is a timing window, not the gate.
    let previous = '';
    await poll.until(
      async () => {
        const o = await api.orders.getById(synthesized.order.internalOrderId);
        const now = `${o.recordStatus}|${o.cancelledAt ?? ''}|${(o as { updatedAt?: string }).updatedAt ?? ''}`;
        const stable = now === previous && o.recordStatus === 'ready';
        previous = now;
        return stable;
      },
      (stable) => stable,
      { message: 'the cancelled order record to settle', timeoutMs: 120_000, intervalMs: 5_000 }
    );

    // API: refused once, naming the code to confirm.
    const refusal = await failureOf(
      api.invoices.issue({ connectionId: ksef.id, orderId: synthesized.order.internalOrderId })
    );
    expect(refusal?.status).toBe(409);
    expect(refusal?.body.warningCode).toBe('order-cancelled');

    // UI: the same refusal opens the confirm dialog with the server's sentence.
    const detail = await pages.ordersList.open(synthesized.order.internalOrderId);
    await detail.invoice.selectConnection(ksef.name);
    await detail.invoice.openManualOverride();
    await shot(page, testInfo, 'gate/01-cancelled-order-before-issue');
    await detail.invoice.manualIssueButton.click();
    await expect(detail.invoice.acknowledgeDialog).toBeVisible();
    await expect(detail.invoice.acknowledgeDialog).toContainText('This order is cancelled');
    await shot(page, testInfo, 'gate/02-confirm-dialog-cancelled-order');

    await detail.invoice.acknowledgeDialog.getByRole('button', { name: 'Continue anyway' }).click();
    const issued = await poll.until(
      () => api.invoices.getForOrder(synthesized.order.internalOrderId, ksef.id),
      (r) => r.status === 'issued' || r.status === 'failed',
      { message: 'the confirmed invoice to be issued', timeoutMs: 180_000, intervalMs: 5_000 }
    );
    expect(issued.status).toBe('issued');
    await page.reload();
    await shot(page, testInfo, 'gate/03-issued-after-confirm');
  });

  test('a document whose order is refunded afterwards is flagged, not blocked', async ({
    api,
    world,
    jobs,
    poll,
    pages,
    page,
  }, testInfo) => {
    const ksef = requireKsef(world);
    const synthesized = await ksefOrder({ api, world, jobs, poll });
    const accepted = await issueAndClear(
      { api, jobs, poll },
      ksef,
      synthesized.order.internalOrderId
    );
    expect(accepted.status).toBe('issued');

    const before = await api.orders.getById(synthesized.order.internalOrderId);
    expect(before.salesDocument?.afterIssueAttention ?? null).toBeNull();

    const totals = (before.orderSnapshot.totals ?? {}) as { total?: number; currency?: string };
    const total = Number(totals.total ?? 0);
    test.skip(!(total > 1), 'the synthesized order has no total to refund part of');
    await api.orders.recordRefund(synthesized.order.internalOrderId, {
      amount: (Math.floor(total * 50) / 100).toFixed(2),
      currency: totals.currency ?? 'PLN',
      reason: 'withdrawal',
      idempotencyKey: `e2e-def26-${synthesized.order.internalOrderId}`,
    });

    const after = await api.orders.getById(synthesized.order.internalOrderId);
    expect(after.salesDocument?.afterIssueAttention).toBe('order-partially-refunded-after-issue');

    await pages.ordersList.open(synthesized.order.internalOrderId);
    const callout = page.getByTestId('sales-document-after-issue-attention');
    await expect(callout).toContainText('Part refunded');
    await shot(page, testInfo, 'gate/04-after-issue-partial-refund-callout');
  });
});
