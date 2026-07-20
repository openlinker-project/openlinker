/**
 * Invoicing: payment marking, both directions (#1573, scenario 2)
 *
 * OL -> inFakt: `POST /invoices/:id/mark-paid` pushes an authoritative "paid"
 * state to the provider (`PaymentMarker`, #1362). The endpoint's own response
 * DTO does not currently expose the invoice's `paymentStatus` field (only the
 * domain entity carries it — see `InvoiceRecordResponseDto` /
 * `libs/core/src/invoicing/domain/entities/invoice-record.entity.ts`), so this
 * spec asserts what IS observable at the API boundary: the provider accepted
 * the mark (200, no error) and the record is otherwise unchanged. A full
 * round-trip assertion needs `paymentStatus` on the read DTO — flagged as a
 * follow-up in the PR/issue, not implemented here (no `apps/api` changes in
 * scope for this suite).
 *
 * inFakt -> OL: mirrors `tests/webhooks/inbound-webhook.spec.ts`'s real signed-
 * delivery pattern, but for Infakt's own scheme (`X-Infakt-Signature =
 * HMAC-SHA256(rawBody, secret)` hex, no timestamp header, #1281/ADR-021) and
 * the `invoice_marked_as_paid` event, which routes to the `invoice-payment`
 * domain -> `invoicing.paymentStatus.refreshByExternalId` job
 * (`inbound-routing-policy.service.ts`). Verified the same way #1512 is: the
 * delivery is recorded, verified, and enqueued — no tunnel needed, since this
 * signs and posts directly at the OL API the way #1512 already does (the
 * "tunnel" caveat in the issue only applies to a REAL external inFakt server
 * delivering over the internet, not this direct-post simulation).
 *
 * @module tests/invoicing
 */
import { test, expect } from '../../src/fixtures/test';
import { PlatformType } from '../../src/world/world';
import { synthesizeOrder, buildPrestashopWebserviceClient } from '../../src/support/order-synthesis';
import { buildInfaktPaymentWebhook } from '../../src/support/webhooks';

test.describe('invoicing: payment marking', () => {
  test('OL -> inFakt: mark-paid is accepted by the provider', async ({ api, world, jobs, poll }, testInfo) => {
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
      (r) => r.status === 'issued',
      { message: 'inFakt invoice to be issued', timeoutMs: 60_000 },
    );

    const marked = await api.invoices.markPaid(issued.id);
    expect(marked.id).toBe(issued.id);
    expect(marked.status).toBe('issued');

    testInfo.annotations.push({
      type: 'known-gap',
      description:
        'InvoiceRecordResponseDto omits paymentStatus, so a round-trip assertion of the ' +
        'mark-paid effect is not observable via the API today (product gap — recommend ' +
        'exposing paymentStatus on GET /invoices/:id)',
    });
  });

  test('inFakt -> OL: a signed invoice_marked_as_paid webhook is verified, recorded, and enqueued', async ({
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

    const synthesized = await synthesizeOrder({ api, world, jobs, poll });
    await api.invoices.issue({ connectionId: infakt!.id, orderId: synthesized.order.internalOrderId });
    const issued = await poll.until(
      () => api.invoices.getForOrder(synthesized.order.internalOrderId, infakt!.id),
      (r) => r.status === 'issued' && !!r.providerInvoiceId,
      { message: 'inFakt invoice to be issued with a provider id', timeoutMs: 60_000 },
    );

    let secret: string;
    try {
      secret = (await api.connections.rotateWebhookSecret(infakt!.id)).secret;
    } catch (error) {
      test.skip(true, `could not rotate the inFakt connection's webhook secret: ${String(error)}`);
      return;
    }

    const since = new Date(Date.now() - 5_000).toISOString();
    const signed = buildInfaktPaymentWebhook(secret, issued.providerInvoiceId!);

    const result = await api.webhooks.sendInbound('infakt', infakt!.id, signed.rawBody, signed.headers);
    expect(
      result.status,
      `expected 202 for a correctly-signed inFakt webhook, got ${result.status}: ${JSON.stringify(result.body)}`,
    ).toBe(202);

    const enqueued = await poll.until(
      () =>
        api.webhooks.listDeliveries({
          provider: 'infakt',
          connectionId: infakt!.id,
          since,
          limit: 100,
        }),
      (page) => page.items.some((d) => d.status === 'job_enqueued' && !!d.downstreamJobId),
      { message: 'inFakt payment webhook delivery to reach status=job_enqueued', timeoutMs: 60_000 },
    );
    const row = enqueued.items.find((d) => d.status === 'job_enqueued' && !!d.downstreamJobId)!;
    expect(row.signatureValid).toBe(true);
    expect(row.downstreamJobType).toBe('invoicing.paymentStatus.refreshByExternalId');

    testInfo.annotations.push({
      type: 'invoicing',
      description: `inFakt payment webhook routed to job ${row.downstreamJobId} for invoice ${issued.id}`,
    });
  });
});
