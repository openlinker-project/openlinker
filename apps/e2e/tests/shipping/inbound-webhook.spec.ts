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
  SYNTHETIC_COURIER_PARCEL,
  buildCourierRecipient,
  ensureCarrierRouting,
  releaseDispatchedShipments,
  shippingOrderShortageReason,
  resolveDispatchedShipment,
  resolveOrderDeliveryMethodId,
  resolveShippingTestOrder,
} from '../../src/support/shipments';
import { buildInpostTrackingEnvelope, signInpostWebhook } from '../../src/support/webhooks';
import {
  restoreWebhookSecret,
  webhookSecretRotationAnnotation,
} from '../../src/support/webhook-secret';

const PROVIDER = PlatformType.inpost;

test.describe('shipping — inbound ShipX status webhook', () => {
  // Recycle the fixture pool. Every dispatch leaves a non-terminal shipment on
  // its order, and `resolveShippingTestOrder` refuses an order that already has
  // one - so without this the suite eats its own pool and every shipping spec
  // eventually `test.skip`s green with zero coverage. Best-effort and silent on
  // an already-confirmed shipment; `afterAll`, so a failing test still recycles.
  test.afterAll(async ({ api }) => {
    await releaseDispatchedShipments(api);
  });

  /**
   * The connection this run rotated, so teardown can attempt the repair even
   * when the test throws after the rotate. InPost is the hard case: OL ships no
   * `WebhookProvisioningPort` for it, so `install` answers 400 and the repair is
   * genuinely impossible from here - `restoreWebhookSecret` then warns to stdout
   * naming the manual follow-up. That is the whole reason this spec stays gated
   * behind `E2E_TEST_INPOST_WEBHOOK` (see the module doc): it mutates state the
   * suite cannot put back.
   */
  let rotatedConnectionId: string | null = null;

  test.afterAll(async ({ api }) => {
    if (!rotatedConnectionId) return;
    await restoreWebhookSecret(api, PROVIDER, rotatedConnectionId);
  });

  test('verifies, records, and enqueues a signed InPost tracking webhook', async ({
    api,
    world,
    env,
    poll,
  }, testInfo) => {
    test.skip(
      !env.testInpostWebhook,
      'gated behind E2E_TEST_INPOST_WEBHOOK=true (see module doc for why)',
    );

    const inpost = world.connectionFor(PROVIDER);
    test.skip(!inpost, 'no InPost connection on this stack');

    const order = await resolveShippingTestOrder(api, env);
    test.skip(
      !order,
      shippingOrderShortageReason(),
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
    const shipment = await resolveDispatchedShipment(api, dispatch, order!.internalOrderId);
    expect(shipment, 'a shipment exists for the webhook to reference').toBeTruthy();
    expect(shipment.providerShipmentId, 'shipment carries a ShipX provider id').toBeTruthy();

    const rotated = await api.connections.rotateWebhookSecret(inpost!.id);
    // Record the mutation the moment it happens: if the assertions below fail,
    // the report still says this run changed the InPost signing secret.
    rotatedConnectionId = inpost!.id;
    testInfo.annotations.push(webhookSecretRotationAnnotation(PROVIDER, inpost!.id));
    const since = new Date(Date.now() - 5_000).toISOString();
    const signed = signInpostWebhook(
      rotated.secret,
      buildInpostTrackingEnvelope({ providerShipmentId: shipment.providerShipmentId! }),
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
      (page) => page.items.some((d) => d.externalId === shipment.providerShipmentId),
      {
        message: `webhook delivery for shipment ${shipment.providerShipmentId} to be recorded`,
        timeoutMs: 30_000,
      },
    );
    const delivery = recorded.items.find((d) => d.externalId === shipment.providerShipmentId)!;
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
        const row = page.items.find((d) => d.externalId === shipment.providerShipmentId);
        return !!row && row.status === 'job_enqueued' && !!row.downstreamJobId;
      },
      {
        message: `webhook delivery for shipment ${shipment.providerShipmentId} to reach status=job_enqueued`,
        timeoutMs: 60_000,
      },
    );
    const enqueuedRow = enqueued.items.find(
      (d) => d.externalId === shipment.providerShipmentId,
    )!;
    expect(enqueuedRow.downstreamJobType).toBe('marketplace.shipment.syncByExternalId');

    // `downstreamJobId` is the QUEUE-assigned id: a Redis stream message id
    // (`<ms>-<seq>`), or the idempotency key when the enqueue was deduped. NOT
    // a `sync_jobs` UUID (see `EnqueueJobResult` in
    // `libs/core/src/sync/domain/types/sync-job.types.ts`), so a
    // `GET /sync/jobs/:id` on it answers 400 rather than the job. The row only
    // exists once the runner picks the message up; `downstreamJobType` above is
    // the assertable signal. Kept in lock-step with the same assertion in
    // `tests/webhooks/inbound-webhook.spec.ts`.
    expect(enqueuedRow.downstreamJobId).not.toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
