/**
 * Invoicing: bulk issue, resend, and e-mail (#1573, scenario 3)
 *
 * `POST /invoices/bulk-issue` fans out over the same single-order issue
 * primitive `POST /invoices` composes (`invoicing.controller.ts` — no
 * parallel bulk pipeline), so this is exercised directly at the API boundary
 * rather than through the invoices-list-page's row-selection wizard: the FE
 * "bulk issue" affordance operates on already-listed pending/failed invoice
 * rows via the same endpoint, and driving that UI adds fragility without
 * exercising any code path this API call doesn't already cover.
 *
 * Resend-to-KSeF (`RegulatoryResubmitter`) is gated to `rejected` documents
 * (409 otherwise, `invoicing.controller.ts` resendToKsef) — reliably forcing a
 * genuine sandbox rejection is not deterministic for an unattended run, so
 * this asserts the GATE itself: resending an `accepted` document returns 409,
 * which is the resend endpoint's real, deterministic, always-true contract.
 *
 * E-mail send (`InvoiceEmailSender`, #1353) is exercised for real against the
 * inFakt sandbox.
 *
 * @module tests/invoicing
 */
import { test, expect } from '../../src/fixtures/test';
import { PlatformType } from '../../src/world/world';
import { ApiError } from '../../src/api/api-error';
import { synthesizeOrder, buildPrestashopWebserviceClient } from '../../src/support/order-synthesis';

test.describe('invoicing: bulk issue, resend, e-mail', () => {
  test('bulk-issues invoices for two synthesized orders in one call', async ({
    api,
    world,
    jobs,
    poll,
  }, testInfo) => {
    const infakt = world.connectionFor(PlatformType.infakt);
    test.skip(!infakt, 'no inFakt connection on this stack');
    test.skip(
      !buildPrestashopWebserviceClient(world),
      'OL_PS_WEBSERVICE_KEY (+ a resolvable PS base URL) is required to synthesize an order',
    );

    const first = await synthesizeOrder({ api, world, jobs, poll });
    const second = await synthesizeOrder({ api, world, jobs, poll });
    const orderIds = [first.order.internalOrderId, second.order.internalOrderId];

    const result = await api.invoices.bulkIssue({ connectionId: infakt!.id, orderIds });
    expect(result.issued, `bulk issue result: ${JSON.stringify(result.results)}`).toBe(2);
    expect(result.failed).toBe(0);
    for (const orderId of orderIds) {
      const outcome = result.results.find((r) => r.orderId === orderId);
      expect(outcome, `bulk issue outcome for ${orderId}`).toBeTruthy();
      expect(outcome!.outcome).toBe('issued');
      expect(outcome!.invoiceId).toBeTruthy();
    }

    testInfo.annotations.push({
      type: 'invoicing',
      description: `bulk-issued ${result.issued} invoices for orders ${orderIds.join(', ')}`,
    });
  });

  test('resend-to-KSeF is gated to rejected documents (409 on an accepted one)', async ({
    api,
    world,
    jobs,
    poll,
  }) => {
    const ksef = world.connectionFor(PlatformType.ksef);
    test.skip(!ksef, 'no KSeF connection on this stack');
    test.skip(
      !buildPrestashopWebserviceClient(world),
      'OL_PS_WEBSERVICE_KEY (+ a resolvable PS base URL) is required to synthesize an order',
    );

    const synthesized = await synthesizeOrder({ api, world, jobs, poll });
    await api.invoices.issue({ connectionId: ksef!.id, orderId: synthesized.order.internalOrderId });
    const accepted = await poll.until(
      async () => {
        await jobs
          .trigger({
            connectionId: ksef!.id,
            jobType: 'invoicing.regulatoryStatus.reconcile',
            payload: { schemaVersion: 1 },
          })
          .catch(() => undefined);
        return api.invoices.getForOrder(synthesized.order.internalOrderId, ksef!.id);
      },
      (r) => r.regulatoryStatus === 'accepted',
      { message: 'KSeF invoice to reach accepted', timeoutMs: 300_000, intervalMs: 10_000 },
    );

    const error = await api.invoices
      .resendToKsef(accepted.id)
      .then(() => null)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
  });

  test('e-mails an issued inFakt invoice to the buyer', async ({ api, world, jobs, poll }, testInfo) => {
    const infakt = world.connectionFor(PlatformType.infakt);
    test.skip(!infakt, 'no inFakt connection on this stack');
    test.skip(
      !buildPrestashopWebserviceClient(world),
      'OL_PS_WEBSERVICE_KEY (+ a resolvable PS base URL) is required to synthesize an order',
    );

    const synthesized = await synthesizeOrder({ api, world, jobs, poll });
    await api.invoices.issue({ connectionId: infakt!.id, orderId: synthesized.order.internalOrderId });
    const issued = await poll.until(
      () => api.invoices.getForOrder(synthesized.order.internalOrderId, infakt!.id),
      (r) => r.status === 'issued' && !!r.providerInvoiceId,
      { message: 'inFakt invoice to be issued with a provider id', timeoutMs: 60_000 },
    );

    const result = await api.invoices.sendEmail(issued.id);
    expect(typeof result.delivered).toBe('boolean');
    testInfo.annotations.push({
      type: 'invoicing',
      description: `send-email for invoice ${issued.id}: delivered=${result.delivered}, recipient=${result.recipient ?? '(unknown)'}`,
    });
  });
});
