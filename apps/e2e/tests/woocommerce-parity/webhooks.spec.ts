/**
 * WooCommerce parity — scenario 5: inbound webhooks
 *
 * Mirrors `tests/webhooks/inbound-webhook.spec.ts` (#1512) for the
 * WooCommerce provider: rotate the connection's webhook secret, sign an order
 * delivery with it and assert verify -> record -> enqueue -> dedup against a
 * real running receiver. Also drives the
 * `POST /connections/:id/webhooks/install` auto-provisioning action (#1548).
 *
 * PLATFORM-NATIVE SIGNING (#1563): unlike the PrestaShop spec, these
 * deliveries are signed the way the STORE itself signs them —
 * `x-wc-webhook-signature: base64(HMAC_SHA256(secret, rawBody))` over a WC
 * REST order body, classified by `x-wc-webhook-topic`. The gap this spec
 * originally documented (no WooCommerce decoder ⇒ the host fell back to the
 * generic OL-HMAC decoder for every provider) is closed:
 * `WooCommerceInboundWebhookDecoderAdapter` now owns the WC path, so an
 * OL-HMAC-signed delivery is correctly rejected with 401 and only a
 * platform-shaped delivery exercises the real receiver end to end.
 *
 * The decoder derives the eventId from the body itself
 * (`woocommerce-<sha256(id:status:topic:date_modified_gmt)>`) rather than
 * letting the caller pick one, so `signWooCommerceWebhook` returns the id it
 * will land under — that is what the delivery poll keys on.
 *
 * Self-configuring: skips with a clear reason when no WooCommerce connection
 * exists, or its webhook secret cannot be rotated.
 *
 * @module tests/woocommerce-parity
 */
import { test, expect } from '../../src/fixtures/test';
import { PlatformType } from '../../src/world/world';
import type { Connection } from '../../src/api/api.types';
import { ApiError } from '../../src/api/api-error';
import type { ApiClient } from '../../src/api/api-client';
import {
  buildWooCommerceOrderWebhookBody,
  signWooCommerceWebhook,
} from '../../src/support/webhooks';
import { restoreWebhookSecret } from '../../src/support/webhook-secret';

const PROVIDER = PlatformType.woocommerce;

test.describe('WooCommerce inbound webhooks', () => {
  let connection: Connection | undefined;
  /**
   * Whether any case in this file has rotated the shared secret, so teardown
   * knows whether the stack owes a repair. Set by `rotateSecret`, never reset -
   * one rotation anywhere in the file leaves the store out of sync.
   */
  let rotated = false;

  test.beforeAll(({ world }) => {
    connection = world.connectionFor(PROVIDER);
  });

  /**
   * Re-provision the store on the way out. A bare rotate changes only OL's
   * stored secret; the WooCommerce webhook records keep the pre-run one, so
   * every genuine store delivery 401s (and per #1814 the connection reads
   * `auth-failing`) until both sides are handed the same secret again - which
   * is exactly what `install` does. Teardown rather than end-of-test, because a
   * case that fails after rotating is the one that leaves the damage.
   */
  test.afterAll(async ({ api }) => {
    if (!connection || !rotated) return;
    await restoreWebhookSecret(api, PROVIDER, connection.id);
  });

  /**
   * Mint a known-good secret INSIDE the test that signs with it, never in a
   * shared `beforeAll`.
   *
   * `POST /connections/:id/webhooks/install` rotates the shared secret as part
   * of provisioning (`WooCommerceWebhookProvisioningAdapter.install` — WC needs
   * the plaintext to store on its own webhook record). A secret captured once
   * for the whole file is therefore invalidated the moment the install test
   * runs, and every later signature 401s. Rotating per-test makes each case
   * independent of file order.
   *
   * Returns `null` when the stack won't hand out a secret, so the caller can
   * skip rather than fail on stack configuration.
   */
  async function rotateSecret(api: ApiClient): Promise<string | null> {
    try {
      const secret = (await api.connections.rotateWebhookSecret(connection!.id)).secret;
      rotated = true;
      return secret;
    } catch {
      return null;
    }
  }

  test('auto-installs webhook configuration on the WooCommerce store', async ({ api }) => {
    test.skip(!connection, `no ${PROVIDER} connection on the stack`);

    // Provisioning needs the operator to have set the OL callback URL on the
    // connection — without it the adapter has no `delivery_url` to register and
    // the API answers 400. That is stack configuration, not a defect, so skip
    // with the reason rather than failing the suite.
    let result;
    try {
      result = await api.connections.installWebhooks(connection!.id);
    } catch (error) {
      const message = error instanceof ApiError ? JSON.stringify(error.body) : String(error);
      test.skip(
        error instanceof ApiError && error.status === 400,
        `WooCommerce connection is not ready for webhook provisioning: ${message}`,
      );
      throw error;
    }
    // WooCommerce has no synchronous, verifiable test ping (documented on the
    // adapter) — only `webhooksConfigured` is a meaningful pass/fail signal.
    expect(result.webhooksConfigured, `webhook install reports success: ${result.warning ?? ''}`).toBe(true);
  });

  test('verifies, records, enqueues, and dedupes a signed inbound webhook', async ({ api, poll }, testInfo) => {
    test.skip(!connection, `no ${PROVIDER} connection on the stack — cannot fire a webhook`);
    const secret = await rotateSecret(api);
    test.skip(secret === null, `could not rotate the ${PROVIDER} webhook secret`);
    const connectionId = connection!.id;
    testInfo.annotations.push({
      type: 'inbound-webhook',
      description: `signed ${PROVIDER} webhook against connection ${connectionId}`,
    });

    const since = new Date(Date.now() - 5_000).toISOString();
    const signed = signWooCommerceWebhook(secret!, buildWooCommerceOrderWebhookBody());
    const { eventId, topic: eventType } = signed;

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

    // Queue-assigned id (Redis stream message id), not a `sync_jobs` UUID —
    // see the note in `tests/webhooks/inbound-webhook.spec.ts`.

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
    const staleSecret = await rotateSecret(api);
    test.skip(staleSecret === null, `could not rotate the ${PROVIDER} webhook secret`);
    const connectionId = connection!.id;
    testInfo.annotations.push({
      type: 'inbound-webhook',
      description: `secret-rotation invalidation against connection ${connectionId}`,
    });

    // Rotate a second time to make `staleSecret` genuinely stale. Goes through
    // the helper so the teardown repair flag is set for this rotation too.
    // Assert it actually produced a secret first: the helper answers `null` on
    // failure, and `expect(null).not.toBe(staleSecret)` would pass while the
    // secret was never rotated, leaving the rest of the test asserting nothing.
    const currentSecret = await rotateSecret(api);
    expect(currentSecret, 'the second rotation returned a secret').not.toBeNull();
    expect(currentSecret).not.toBe(staleSecret);

    const since = new Date(Date.now() - 5_000).toISOString();
    const signedWithStaleSecret = signWooCommerceWebhook(
      staleSecret!,
      buildWooCommerceOrderWebhookBody(),
    );
    const { eventId, topic: eventType } = signedWithStaleSecret;

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
  });
});
