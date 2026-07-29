/**
 * Webhook Delivery Status Monotonicity Integration Test (#1916)
 *
 * The ingress API stamps `published` *after* publishing to the Redis stream,
 * while the consumer that reads that stream stamps `job_enqueued` /
 * `deadlettered` - routinely first. Nothing orders the two writes, so the
 * `ON CONFLICT DO UPDATE` set-list must resolve `status` by lifecycle rank
 * instead of by arrival, or a delivery that was fully routed reports as merely
 * published (and carries a `downstreamJobId` while claiming `published`).
 *
 * The guard is a SQL CASE expression, so it can only be proved against real
 * Postgres - the unit spec at
 * `libs/core/src/webhooks/.../__tests__/webhook-delivery.repository.spec.ts`
 * asserts the emitted statement, this one asserts the resulting rows.
 *
 * @module apps/api/test/integration
 */
import { randomUUID } from 'crypto';
import { WEBHOOK_DELIVERY_REPOSITORY_TOKEN } from '@openlinker/core/webhooks';
import type { WebhookDeliveryRepositoryPort } from '@openlinker/core/webhooks';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { IntegrationTestHarness } from './setup';

const PROVIDER = 'prestashop';

describe('Webhook delivery status monotonicity (#1916)', () => {
  let harness: IntegrationTestHarness;
  let repository: WebhookDeliveryRepositoryPort;

  beforeAll(async () => {
    harness = await getTestHarness();
    repository = harness
      .getApp()
      .get<WebhookDeliveryRepositoryPort>(WEBHOOK_DELIVERY_REPOSITORY_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  /** A fresh event key per case so cases never collide on the unique index. */
  function eventKey(): { eventId: string; provider: string; connectionId: string } {
    return { eventId: `status-ladder-${randomUUID()}`, provider: PROVIDER, connectionId: randomUUID() };
  }

  /** What the ingress API writes first (the Postgres dedup gate, #711). */
  async function ingressReceived(key: ReturnType<typeof eventKey>): Promise<void> {
    const result = await repository.insertIfNew({
      ...key,
      eventType: 'order.created',
      receivedAt: new Date(),
      signatureValid: true,
      status: 'received',
    });
    expect(result.isNew).toBe(true);
  }

  /** What the ingress API writes after the stream publish succeeds. */
  async function ingressPublished(key: ReturnType<typeof eventKey>): Promise<void> {
    await repository.upsert({
      ...key,
      dedupResult: 'new',
      status: 'published',
      publishedMessageId: '1785315056948-0',
    });
  }

  /** What the stream consumer writes once it has enqueued the downstream job. */
  async function consumerEnqueued(key: ReturnType<typeof eventKey>): Promise<void> {
    await repository.upsert({
      ...key,
      status: 'job_enqueued',
      downstreamJobId: 'job-1916',
      downstreamJobType: 'marketplace.order.sync',
    });
  }

  async function read(
    key: ReturnType<typeof eventKey>
  ): Promise<{ status: string; downstreamJobId: string | null; publishedMessageId: string | null }> {
    const { items } = await repository.findMany(
      { provider: key.provider, connectionId: key.connectionId },
      { limit: 10, offset: 0 }
    );
    const row = items.find((item) => item.eventId === key.eventId);
    if (!row) throw new Error(`delivery row not found for ${key.eventId}`);
    return {
      status: row.status,
      downstreamJobId: row.downstreamJobId,
      publishedMessageId: row.publishedMessageId,
    };
  }

  it('should keep job_enqueued when the ingress published write lands last (the racing order that broke CI)', async () => {
    const key = eventKey();
    await ingressReceived(key);
    await consumerEnqueued(key);
    await ingressPublished(key);

    const row = await read(key);
    expect(row.status).toBe('job_enqueued');
    // The loser's non-status columns still land - only `status` is guarded.
    expect(row.publishedMessageId).toBe('1785315056948-0');
    expect(row.downstreamJobId).toBe('job-1916');
  });

  it('should reach job_enqueued when the writes arrive in lifecycle order', async () => {
    const key = eventKey();
    await ingressReceived(key);
    await ingressPublished(key);
    await consumerEnqueued(key);

    const row = await read(key);
    expect(row.status).toBe('job_enqueued');
    expect(row.downstreamJobId).toBe('job-1916');
  });

  it('should never leave status=published on a row that carries a downstream job id', async () => {
    for (const order of ['consumer-first', 'ingress-first'] as const) {
      const key = eventKey();
      await ingressReceived(key);
      if (order === 'consumer-first') {
        await consumerEnqueued(key);
        await ingressPublished(key);
      } else {
        await ingressPublished(key);
        await consumerEnqueued(key);
      }

      const row = await read(key);
      expect(row.downstreamJobId).not.toBeNull();
      expect(row.status).not.toBe('published');
    }
  });

  it('should not let a later published or job_enqueued write clear a dead-letter', async () => {
    const key = eventKey();
    await ingressReceived(key);
    await repository.upsert({ ...key, status: 'deadlettered', dlqReason: 'ungated: order requires OrderSource' });

    await ingressPublished(key);
    expect((await read(key)).status).toBe('deadlettered');

    await consumerEnqueued(key);
    expect((await read(key)).status).toBe('deadlettered');
  });

  it('should not regress a published row to received (the consumer test.* event path)', async () => {
    const key = eventKey();
    await ingressReceived(key);
    await ingressPublished(key);
    await repository.upsert({ ...key, eventType: 'test.ping', status: 'received' });

    const row = await read(key);
    expect(row.status).toBe('published');
  });

  it('should still advance a fresh row through received -> published', async () => {
    const key = eventKey();
    await ingressReceived(key);
    expect((await read(key)).status).toBe('received');

    await ingressPublished(key);
    expect((await read(key)).status).toBe('published');
  });
});
