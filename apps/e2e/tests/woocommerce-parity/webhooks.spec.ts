/**
 * WooCommerce parity — scenario 5: inbound webhooks
 *
 * Mirrors `tests/webhooks/inbound-webhook.spec.ts` (#1512) for the
 * WooCommerce provider: rotate the connection's webhook secret, sign a
 * synthetic order envelope with it (OL-HMAC, exactly as the PrestaShop spec
 * does — see the module doc there for why a synthetic envelope is the
 * established pattern rather than a real platform-native delivery), and
 * assert verify -> record -> enqueue -> dedup against a real running
 * receiver. Also drives the `POST /connections/:id/webhooks/install`
 * auto-provisioning action (#1548) and asserts it reports success.
 *
 * KNOWN GAP (documented in `WooCommerceWebhookProvisioningAdapter`, #1563):
 * WooCommerce signs its OWN real deliveries with `X-WC-Webhook-Signature`
 * (base64 HMAC over the raw body, no timestamp) — a scheme the host's
 * `DefaultWebhookDecoder` cannot verify. There is no WooCommerce-specific
 * `InboundWebhookDecoderPort` yet, so the receiver falls back to the generic
 * OL-HMAC decoder regardless of provider. That is what makes the synthetic
 * OL-HMAC-signed envelope below verify successfully — but it also means a
 * REAL WooCommerce-native webhook delivery would currently FAIL verification
 * end-to-end. That gap is tracked by #1563 and is NOT re-implemented or
 * worked around here.
 *
 * Self-configuring: skips with a clear reason when no WooCommerce connection
 * exists, or its webhook secret cannot be rotated.
 *
 * @module tests/woocommerce-parity
 */
import { test, expect } from '../../src/fixtures/test';
import { PlatformType } from '../../src/world/world';
import type { Connection } from '../../src/api/api.types';
import { buildOrderWebhookEnvelope, signWebhook } from '../../src/support/webhooks';

const PROVIDER = PlatformType.woocommerce;

test.describe('WooCommerce inbound webhooks', () => {
  let connection: Connection | undefined;
  let secret: string | null = null;
  let setupError: string | null = null;

  test.beforeAll(async ({ api, world }) => {
    connection = world.connectionFor(PROVIDER);
    if (!connection) return;
    try {
      const rotated = await api.connections.rotateWebhookSecret(connection.id);
      secret = rotated.secret;
    } catch (error) {
      setupError = error instanceof Error ? error.message : String(error);
    }
  });

  test('auto-installs webhook configuration on the WooCommerce store', async ({ api }) => {
    test.skip(!connection, `no ${PROVIDER} connection on the stack`);

    const result = await api.connections.installWebhooks(connection!.id);
    // WooCommerce has no synchronous, verifiable test ping (documented on the
    // adapter) — only `webhooksConfigured` is a meaningful pass/fail signal.
    expect(result.webhooksConfigured, `webhook install reports success: ${result.warning ?? ''}`).toBe(true);
  });

  test('verifies, records, enqueues, and dedupes a signed inbound webhook', async ({ api, poll }, testInfo) => {
    test.skip(!connection, `no ${PROVIDER} connection on the stack — cannot fire a webhook`);
    test.skip(
      secret === null,
      `could not rotate ${PROVIDER} webhook secret${setupError ? `: ${setupError}` : ''}`,
    );
    const connectionId = connection!.id;
    testInfo.annotations.push({
      type: 'inbound-webhook',
      description: `signed ${PROVIDER} webhook against connection ${connectionId}`,
    });

    const since = new Date(Date.now() - 5_000).toISOString();
    const signed = signWebhook(secret!, buildOrderWebhookEnvelope());
    const { eventId, eventType } = signed.envelope;

    const first = await api.webhooks.sendInbound(PROVIDER, connectionId, signed.rawBody, signed.headers);
    expect(
      first.status,
      `expected 202 for a correctly-signed webhook, got ${first.status}: ${JSON.stringify(first.body)}`,
    ).toBe(202);

    const recorded = await poll.until(
      () =>
        api.webhooks.listDeliveries({ provider: PROVIDER, connectionId, eventType, since, limit: 100 }),
      (page) => page.items.some((d) => d.eventId === eventId),
      { message: `webhook delivery for eventId=${eventId} to be recorded`, timeoutMs: 30_000 },
    );
    const delivery = recorded.items.find((d) => d.eventId === eventId)!;
    expect(delivery.signatureValid).toBe(true);
    expect(delivery.provider).toBe(PROVIDER);

    const enqueued = await poll.until(
      () =>
        api.webhooks.listDeliveries({ provider: PROVIDER, connectionId, eventType, since, limit: 100 }),
      (page) => {
        const row = page.items.find((d) => d.eventId === eventId);
        return !!row && row.status === 'job_enqueued' && !!row.downstreamJobId;
      },
      { message: `webhook delivery ${eventId} to reach status=job_enqueued`, timeoutMs: 60_000 },
    );
    const enqueuedRow = enqueued.items.find((d) => d.eventId === eventId)!;
    expect(enqueuedRow.downstreamJobId).toBeTruthy();
    expect(enqueuedRow.downstreamJobType).toBe('marketplace.order.sync');

    const job = await api.syncJobs.getById(enqueuedRow.downstreamJobId!);
    expect(job.jobType).toBe('marketplace.order.sync');

    // Replaying the byte-identical request is deduped (Postgres gate #711).
    const replay = await api.webhooks.sendInbound(PROVIDER, connectionId, signed.rawBody, signed.headers);
    expect(replay.status).toBe(202);

    const afterReplay = await api.webhooks.listDeliveries({
      provider: PROVIDER,
      connectionId,
      eventType,
      since,
      limit: 100,
    });
    expect(afterReplay.items.filter((d) => d.eventId === eventId)).toHaveLength(1);
  });

  test('a rotated secret invalidates a signature computed with the old one', async ({ api }, testInfo) => {
    test.skip(!connection, `no ${PROVIDER} connection on the stack`);
    test.skip(
      secret === null,
      `could not rotate ${PROVIDER} webhook secret${setupError ? `: ${setupError}` : ''}`,
    );
    const connectionId = connection!.id;
    testInfo.annotations.push({
      type: 'inbound-webhook',
      description: `secret-rotation invalidation against connection ${connectionId}`,
    });

    const staleSecret = secret!;
    const rotated = await api.connections.rotateWebhookSecret(connectionId);
    expect(rotated.secret).not.toBe(staleSecret);

    const since = new Date(Date.now() - 5_000).toISOString();
    const signedWithStaleSecret = signWebhook(staleSecret, buildOrderWebhookEnvelope());
    const { eventId, eventType } = signedWithStaleSecret.envelope;

    const result = await api.webhooks.sendInbound(
      PROVIDER,
      connectionId,
      signedWithStaleSecret.rawBody,
      signedWithStaleSecret.headers,
    );
    expect(result.status, 'a signature computed with the rotated-out secret is rejected').toBe(401);

    const deliveries = await api.webhooks.listDeliveries({
      provider: PROVIDER,
      connectionId,
      eventType,
      since,
      limit: 100,
    });
    expect(deliveries.items.some((d) => d.eventId === eventId)).toBe(false);

    // Re-establish a known-good secret for any later test in this file/run.
    secret = rotated.secret;
  });
});
