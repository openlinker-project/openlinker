/**
 * Inbound webhook: real signed delivery (end-to-end)
 *
 * The golden path ingests orders via manual job-trigger / poll — it never fires
 * a real `POST /webhooks/:provider/:connectionId`. This spec closes that gap for
 * the low-latency PRIMARY path (#1512): it signs an inbound PrestaShop webhook
 * with the connection's own webhook secret (OL-HMAC, exactly as the PS module
 * does) and asserts the full receiver chain against a running stack:
 *
 *   verify (signature + timestamp) -> record (webhook_deliveries) -> enqueue
 *   (a downstream sync job) -> replay is deduped (one row, idempotent 202).
 *
 * A tampered-signature request is asserted to be rejected (401) and to leave no
 * delivery row — proving the signature actually gates ingestion.
 *
 * The truly external round-trip (a real PrestaShop / Erli / InPost / inFakt
 * platform delivering through a public tunnel) stays a documented MANUAL check —
 * see docs/manual-testing/inbound-webhook-round-trip.md.
 *
 * Self-configuring: skips-with-annotation when no PrestaShop connection is on
 * the stack or its webhook secret cannot be rotated (mirrors the access-control
 * specs' skip-off-config pattern), so it is a no-op on a stack that isn't wired
 * for webhooks rather than a failure.
 *
 * @module tests/webhooks
 */
import { test, expect } from '../../src/fixtures/test';
import { PlatformType } from '../../src/world/world';
import type { Connection } from '../../src/api/api.types';
import { buildOrderWebhookEnvelope, signWebhook } from '../../src/support/webhooks';

const PROVIDER = PlatformType.prestashop;

test.describe('inbound webhook: signed PrestaShop delivery', () => {
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

  test('verifies, records, enqueues, and dedupes a signed inbound webhook', async ({
    api,
    poll,
  }, testInfo) => {
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

    // Narrow the delivery query to this run only — `order.created` rows from
    // prior runs share the connection + eventType, so filter by receivedAt too.
    const since = new Date(Date.now() - 5_000).toISOString();
    const signed = signWebhook(secret!, buildOrderWebhookEnvelope());
    const { eventId, eventType } = signed.envelope;

    // 1. Fire the signed webhook -> 202 Accepted (verify + record + publish).
    const first = await api.webhooks.sendInbound(
      PROVIDER,
      connectionId,
      signed.rawBody,
      signed.headers,
    );
    expect(
      first.status,
      `expected 202 for a correctly-signed webhook, got ${first.status}: ${JSON.stringify(first.body)}`,
    ).toBe(202);

    // 2. The delivery is recorded against webhook_deliveries with a valid sig.
    const recorded = await poll.until(
      () =>
        api.webhooks.listDeliveries({
          provider: PROVIDER,
          connectionId,
          eventType,
          since,
          limit: 100,
        }),
      (page) => page.items.some((d) => d.eventId === eventId),
      { message: `webhook delivery for eventId=${eventId} to be recorded`, timeoutMs: 30_000 },
    );
    const delivery = recorded.items.find((d) => d.eventId === eventId)!;
    expect(delivery.signatureValid).toBe(true);
    expect(delivery.provider).toBe(PROVIDER);

    // 3. The delivery is routed to a downstream sync job (record -> enqueue).
    //    The WebhookToJobHandler consumes the published event asynchronously and
    //    stamps the row with the enqueued job id/type.
    const enqueued = await poll.until(
      () =>
        api.webhooks.listDeliveries({
          provider: PROVIDER,
          connectionId,
          eventType,
          since,
          limit: 100,
        }),
      (page) => {
        const row = page.items.find((d) => d.eventId === eventId);
        return !!row && row.status === 'job_enqueued' && !!row.downstreamJobId;
      },
      {
        message: `webhook delivery ${eventId} to reach status=job_enqueued`,
        timeoutMs: 60_000,
      },
    );
    const enqueuedRow = enqueued.items.find((d) => d.eventId === eventId)!;
    expect(enqueuedRow.downstreamJobId).toBeTruthy();
    expect(enqueuedRow.downstreamJobType).toBe('marketplace.order.sync');

    // The enqueued job is visible on the sync-jobs API by its id.
    const job = await api.syncJobs.getById(enqueuedRow.downstreamJobId!);
    expect(job.jobType).toBe('marketplace.order.sync');

    // 4. Replaying the byte-identical request is deduped (Postgres gate #711):
    //    still 202 (idempotent ack), and NO second delivery row is created.
    const replay = await api.webhooks.sendInbound(
      PROVIDER,
      connectionId,
      signed.rawBody,
      signed.headers,
    );
    expect(replay.status).toBe(202);

    const afterReplay = await api.webhooks.listDeliveries({
      provider: PROVIDER,
      connectionId,
      eventType,
      since,
      limit: 100,
    });
    const matches = afterReplay.items.filter((d) => d.eventId === eventId);
    expect(matches).toHaveLength(1);
  });

  test('rejects a webhook whose signature does not match the connection secret', async ({
    api,
  }, testInfo) => {
    test.skip(!connection, `no ${PROVIDER} connection on the stack — cannot fire a webhook`);
    test.skip(
      secret === null,
      `could not rotate ${PROVIDER} webhook secret${setupError ? `: ${setupError}` : ''}`,
    );
    const connectionId = connection!.id;
    testInfo.annotations.push({
      type: 'inbound-webhook',
      description: `tampered-signature rejection against connection ${connectionId}`,
    });

    const since = new Date(Date.now() - 5_000).toISOString();
    // Sign with the WRONG secret — the body/headers are well-formed, only the
    // HMAC is wrong, so this exercises signature verification specifically.
    const forged = signWebhook('not-the-real-secret', buildOrderWebhookEnvelope());
    const { eventId, eventType } = forged.envelope;

    const result = await api.webhooks.sendInbound(
      PROVIDER,
      connectionId,
      forged.rawBody,
      forged.headers,
    );
    expect(
      result.status,
      `expected 401 for a bad signature, got ${result.status}: ${JSON.stringify(result.body)}`,
    ).toBe(401);

    // A rejected (unverified) webhook must NOT be recorded — a status='rejected'
    // row would block a legitimate retry via the unique constraint (#711).
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
