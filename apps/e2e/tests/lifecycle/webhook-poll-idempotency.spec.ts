/**
 * Order lifecycle: webhook + poll convergence (idempotency)
 *
 * Part of #1574 (order lifecycle and inventory resilience). Closes #1512 by
 * extending the real-inbound-webhook coverage that PR #1682 already merged
 * (`tests/webhooks/inbound-webhook.spec.ts`): that spec proves the webhook
 * PATH is internally idempotent (a byte-identical replay is deduped by the
 * Postgres delivery-key gate, #711). It does NOT prove anything about the
 * SECOND ingestion path — the `marketplace.orders.poll` reconciliation
 * backstop (docs/architecture-overview.md § Webhook Ingestion Flow) — running
 * for the same connection around the same time.
 *
 * This spec closes that gap: it fires a signed webhook, then drives a REAL
 * `marketplace.orders.poll` job on the SAME connection immediately afterwards
 * (simulating the reconciliation cron overlapping a fresh webhook delivery),
 * then replays the original webhook once more — and asserts the webhook's
 * delivery row / downstream job stay singular throughout.
 *
 * Scope note (honest limitation): the webhook envelope's `object.externalId`
 * is synthetic (mirrors the merged spec), so the poll's cursor-based feed
 * genuinely never rediscovers it — the poll cannot "duplicate" a PrestaShop
 * order that does not exist in the shop. What this DOES prove, and is worth
 * proving: (1) the poll job runs to completion without erroring or disturbing
 * the webhook's already-recorded delivery/job; (2) the webhook's own
 * replay-dedup guarantee still holds with a real poll interleaved in between,
 * not just back-to-back. A full order-record-level dedup proof (same EXTERNAL
 * order landing via both webhook and poll) needs a real PrestaShop order
 * fabricated end-to-end (cart + customer + address) — a materially bigger
 * lift than this spec's file list — and is left as a follow-up (see the #1574
 * PR description for the split).
 *
 * Self-configuring: skips-with-annotation when no PrestaShop connection is on
 * the stack or its webhook secret cannot be rotated (mirrors
 * `inbound-webhook.spec.ts`).
 *
 * @module tests/lifecycle
 */
import { test, expect } from '../../src/fixtures/test';
import { PlatformType } from '../../src/world/world';
import type { Connection } from '../../src/api/api.types';
import { buildOrderWebhookEnvelope, signWebhook } from '../../src/support/webhooks';

const PROVIDER = PlatformType.prestashop;

test.describe('lifecycle: webhook + poll convergence (idempotency, #1574 / closes #1512)', () => {
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

  test('a webhook-created delivery stays singular across an interleaved reconciliation poll', async ({
    api,
    jobs,
    poll,
  }, testInfo) => {
    test.skip(!connection, `no ${PROVIDER} connection on the stack — cannot fire a webhook`);
    test.skip(
      secret === null,
      `could not rotate ${PROVIDER} webhook secret${setupError ? `: ${setupError}` : ''}`,
    );
    const connectionId = connection!.id;
    testInfo.annotations.push({
      type: 'webhook-poll-idempotency',
      description: `signed ${PROVIDER} webhook + reconciliation poll on connection ${connectionId}`,
    });

    const since = new Date(Date.now() - 5_000).toISOString();
    const signed = signWebhook(secret!, buildOrderWebhookEnvelope());
    const { eventId, eventType } = signed.envelope;

    // 1. Fire the signed webhook -> recorded and routed to a downstream job
    //    (mirrors inbound-webhook.spec.ts's own assertions, condensed here as
    //    the starting state this spec's poll interleaving builds on).
    const first = await api.webhooks.sendInbound(
      PROVIDER,
      connectionId,
      signed.rawBody,
      signed.headers,
    );
    expect(first.status, `expected 202 for a correctly-signed webhook, got ${first.status}`).toBe(
      202,
    );

    const enqueued = await poll.until(
      () =>
        api.webhooks.listDeliveries({ provider: PROVIDER, connectionId, eventType, since, limit: 100 }),
      (page) => {
        const row = page.items.find((d) => d.eventId === eventId);
        return !!row && row.status === 'job_enqueued' && !!row.downstreamJobId;
      },
      { message: `webhook delivery ${eventId} to reach status=job_enqueued`, timeoutMs: 60_000 },
    );
    const originalRow = enqueued.items.find((d) => d.eventId === eventId)!;
    const originalJobId = originalRow.downstreamJobId;
    expect(originalJobId, 'webhook delivery carries a downstream job id').toBeTruthy();

    // 2. Drive a REAL reconciliation poll on the SAME connection right after —
    //    the scenario the merged webhook spec never exercises. It must run to
    //    completion without disturbing the webhook's already-recorded delivery.
    await jobs.triggerAndWait(
      { connectionId, jobType: 'marketplace.orders.poll' },
      { timeoutMs: 120_000, expectSuccess: false },
    );

    const afterPoll = await api.webhooks.listDeliveries({
      provider: PROVIDER,
      connectionId,
      eventType,
      since,
      limit: 100,
    });
    const rowsAfterPoll = afterPoll.items.filter((d) => d.eventId === eventId);
    expect(rowsAfterPoll, 'the poll did not create a second delivery row for this eventId').toHaveLength(1);
    expect(
      rowsAfterPoll[0].downstreamJobId,
      'the poll did not re-stamp/replace the webhook-enqueued job id',
    ).toBe(originalJobId);

    // 3. Replay the SAME signed webhook, now with a real poll interleaved
    //    since the original delivery — the Postgres dedup gate (#711) must
    //    still hold; the poll running in between must not have opened a
    //    window for a duplicate delivery.
    const replay = await api.webhooks.sendInbound(
      PROVIDER,
      connectionId,
      signed.rawBody,
      signed.headers,
    );
    expect(replay.status, 'replay after an interleaved poll is still idempotently accepted').toBe(202);

    const afterReplay = await api.webhooks.listDeliveries({
      provider: PROVIDER,
      connectionId,
      eventType,
      since,
      limit: 100,
    });
    expect(
      afterReplay.items.filter((d) => d.eventId === eventId),
      'still exactly one delivery row after webhook -> poll -> replay',
    ).toHaveLength(1);
  });
});
