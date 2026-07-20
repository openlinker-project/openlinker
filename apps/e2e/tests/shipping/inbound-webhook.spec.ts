/**
 * Shipping suite — S8: inbound ShipX status webhook (env-gated)
 *
 * Mirrors `tests/webhooks/inbound-webhook.spec.ts` (#1512) but for InPost's own
 * HMAC scheme (`support/webhooks.ts` § InPost) instead of OL-HMAC: signs a
 * `Shipment.Tracking` / `shipment_status_changed` envelope with the
 * connection's rotated webhook secret and posts it to
 * `POST /webhooks/inpost/:connectionId`, then asserts the full receiver chain
 * — verify -> record (`webhook_deliveries`) -> enqueue
 * (`marketplace.shipment.syncByExternalId`, `InboundRoutingPolicy` case
 * `'shipment'`).
 *
 * Gated behind `E2E_TEST_INPOST_WEBHOOK=true` (off by default, per the issue's
 * "implemented behind an env flag and documented as operator-run" allowance):
 * unlike the PrestaShop webhook spec, this fires against the SAME running
 * stack the suite already targets (no public tunnel needed for the request
 * itself — `sendInbound` posts directly to `env.apiUrl`), but it still
 * mutates real webhook-secret state and enqueues a real downstream job
 * against a live-looking shipment id, so it stays opt-in like the other
 * mutating/destructive gated specs (`E2E_TEST_RATE_LIMIT`).
 *
 * @module tests/shipping
 */
import { test, expect } from '../../src/fixtures/test';
import { PlatformType } from '../../src/world/world';
import {
  buildCourierRecipient,
  ensureCarrierRouting,
  resolveOrderDeliveryMethodId,
  resolveShippingTestOrder,
  SYNTHETIC_COURIER_PARCEL,
} from '../../src/support/shipments';
import { buildInpostTrackingEnvelope, signInpostWebhook } from '../../src/support/webhooks';

const PROVIDER = PlatformType.inpost;

test.describe('shipping — inbound ShipX status webhook', () => {
  test('verifies, records, and enqueues a signed InPost tracking webhook', async ({
    api,
    world,
    env,
    poll,
  }) => {
    test.skip(
      !env.testInpostWebhook,
      'gated behind E2E_TEST_INPOST_WEBHOOK=true (see module doc for why)',
    );

    const inpost = world.connectionFor(PROVIDER);
    test.skip(!inpost, 'no InPost connection on this stack');

    const order = await resolveShippingTestOrder(api, env);
    test.skip(
      !order,
      'no ready order available (set E2E_ORDER_ID or run the golden path first)',
    );

    const deliveryMethodId = resolveOrderDeliveryMethodId(order!);
    await ensureCarrierRouting(api, order!.sourceConnectionId, deliveryMethodId, inpost!.id);
    const dispatch = await api.shipments.generateLabel({
      sourceConnectionId: order!.sourceConnectionId,
      sourceDeliveryMethodId: deliveryMethodId,
      orderId: order!.internalOrderId,
      deliveryIntent: 'address',
      recipient: buildCourierRecipient(order!),
      parcel: { ...SYNTHETIC_COURIER_PARCEL },
    });
    const shipment = dispatch.shipment ?? (await api.shipments.active(order!.internalOrderId));
    expect(shipment, 'a shipment exists for the webhook to reference').toBeTruthy();
    expect(shipment!.providerShipmentId, 'shipment carries a ShipX provider id').toBeTruthy();

    const rotated = await api.connections.rotateWebhookSecret(inpost!.id);
    const since = new Date(Date.now() - 5_000).toISOString();
    const signed = signInpostWebhook(
      rotated.secret,
      buildInpostTrackingEnvelope({ providerShipmentId: shipment!.providerShipmentId! }),
    );

    const result = await api.webhooks.sendInbound(
      PROVIDER,
      inpost!.id,
      signed.rawBody,
      signed.headers,
    );
    expect(
      result.status,
      `expected 202 for a correctly-signed InPost webhook, got ${result.status}: ${JSON.stringify(result.body)}`,
    ).toBe(202);

    const recorded = await poll.until(
      () =>
        api.webhooks.listDeliveries({
          provider: PROVIDER,
          connectionId: inpost!.id,
          since,
          limit: 100,
        }),
      (page) => page.items.some((d) => d.externalId === shipment!.providerShipmentId),
      {
        message: `webhook delivery for shipment ${shipment!.providerShipmentId} to be recorded`,
        timeoutMs: 30_000,
      },
    );
    const delivery = recorded.items.find((d) => d.externalId === shipment!.providerShipmentId)!;
    expect(delivery.signatureValid).toBe(true);
    expect(delivery.provider).toBe(PROVIDER);

    const enqueued = await poll.until(
      () =>
        api.webhooks.listDeliveries({
          provider: PROVIDER,
          connectionId: inpost!.id,
          since,
          limit: 100,
        }),
      (page) => {
        const row = page.items.find((d) => d.externalId === shipment!.providerShipmentId);
        return !!row && row.status === 'job_enqueued' && !!row.downstreamJobId;
      },
      {
        message: `webhook delivery for shipment ${shipment!.providerShipmentId} to reach status=job_enqueued`,
        timeoutMs: 60_000,
      },
    );
    const enqueuedRow = enqueued.items.find(
      (d) => d.externalId === shipment!.providerShipmentId,
    )!;
    expect(enqueuedRow.downstreamJobType).toBe('marketplace.shipment.syncByExternalId');

    const job = await api.syncJobs.getById(enqueuedRow.downstreamJobId!);
    expect(job.jobType).toBe('marketplace.shipment.syncByExternalId');
  });
});
