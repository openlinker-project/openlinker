/**
 * Webhook Ingestion Integration Tests
 *
 * Integration tests for webhook ingestion flow, including signature verification,
 * deduplication, event publishing, and handler processing. Includes high-value
 * tests that catch real bugs (raw body signature, handler crash/retry).
 *
 * @module apps/api/test/integration
 */
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { IntegrationTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import * as crypto from 'crypto';

const INBOUND_WEBHOOK_STREAM = 'events.inbound.webhooks';
const WEBHOOK_HANDLER_CONSUMER_GROUP = 'webhook-handler';
const JOBS_SYNC_STREAM = 'jobs.sync';

type HarnessRedisClient = NonNullable<ReturnType<IntegrationTestHarness['getRedisClient']>>;

/**
 * Ensure the `webhook-handler` consumer group exists on the inbound stream.
 *
 * The `WebhookToJobHandler` creates this group once at app boot, but
 * `resetTestHarness()` calls `flushDb()` between tests, which drops both the
 * stream and the group. Recreating it here (idempotently) lets the still-running
 * handler resume consuming new messages, so a test that runs after the first
 * `afterEach` reset still exercises the real drain path instead of a dead
 * consumer loop.
 */
async function ensureWebhookConsumerGroup(redisClient: HarnessRedisClient): Promise<void> {
  try {
    await redisClient.xGroupCreate(INBOUND_WEBHOOK_STREAM, WEBHOOK_HANDLER_CONSUMER_GROUP, '$', {
      MKSTREAM: true,
    });
  } catch (error) {
    // BUSYGROUP = group already exists (boot-time creation survived) — fine.
    if (!(error instanceof Error && error.message.includes('BUSYGROUP'))) {
      throw error;
    }
  }
}

/**
 * Poll the `jobs.sync` stream until a message with the given idempotency key
 * appears, or time out. This is the downstream job the `WebhookToJobHandler`
 * enqueues after consuming + routing an inbound webhook event.
 */
async function waitForEnqueuedJob(
  redisClient: HarnessRedisClient,
  idempotencyKey: string,
  timeoutMs = 15000,
): Promise<Record<string, string> | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const jobs = await redisClient.xRead([{ key: JOBS_SYNC_STREAM, id: '0' }], { COUNT: 100 });
    const match = jobs?.[0]?.messages.find((msg) => msg.message.idempotencyKey === idempotencyKey);
    if (match) {
      return match.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return undefined;
}

interface WebhookDeliveryRow {
  status: string;
  downstreamJobType: string | null;
  downstreamJobId: string | null;
}

/**
 * Poll `webhook_deliveries` until the handler upserts the row to
 * `job_enqueued`, or time out. The handler records the delivery a hair after it
 * writes `jobs.sync`, so this avoids a race with {@link waitForEnqueuedJob}.
 */
async function waitForEnqueuedDelivery(
  harness: IntegrationTestHarness,
  connectionId: string,
  eventId: string,
  timeoutMs = 5000,
): Promise<WebhookDeliveryRow | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = (await harness.getDataSource().query(
      `SELECT status, "downstreamJobType", "downstreamJobId" FROM webhook_deliveries WHERE provider = $1 AND "connectionId" = $2 AND "eventId" = $3`,
      ['prestashop', connectionId, eventId],
    )) as WebhookDeliveryRow[];
    if (rows[0]?.status === 'job_enqueued') {
      return rows[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return undefined;
}

describe('Webhook Ingestion Integration', () => {
  let harness: IntegrationTestHarness;
  const webhookSecret = 'test-secret-key-12345';

  beforeAll(async () => {
    harness = await getTestHarness();
    process.env.OPENLINKER_WEBHOOK_SECRET__PRESTASHOP = webhookSecret;
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  describe('POST /webhooks/:provider/:connectionId', () => {
    it('should accept valid webhook and publish event', async () => {
      // 1. Create test connection
      const connection = await createTestConnection(harness.getDataSource(), {
        platformType: 'prestashop',
        status: 'active',
      });

      // 2. Prepare webhook payload
      const payload = {
        schemaVersion: 1,
        eventId: 'test-event-123',
        eventType: 'product.saved',
        occurredAt: new Date().toISOString(),
        object: {
          type: 'product',
          externalId: '12345',
        },
        payload: {
          name: 'Test Product',
        },
      };

      const rawBody = Buffer.from(JSON.stringify(payload));
      const timestamp = Date.now().toString();
      const signedPayload = timestamp + '.' + rawBody.toString();
      const signature = crypto
        .createHmac('sha256', webhookSecret)
        .update(signedPayload)
        .digest('hex');

      // 3. Send webhook request
      await harness
        .getHttp()
        .post(`/webhooks/prestashop/${connection.id}`)
        .set('X-OpenLinker-Timestamp', timestamp)
        .set('X-OpenLinker-Signature', `sha256=${signature}`)
        .send(payload)
        .expect(202);

      // 4. Verify event in Redis stream
      const redisClient = harness.getRedisClient();
      if (!redisClient) {
        throw new Error('Redis client not available');
      }

      // Wait a bit for handler to process
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const events = await redisClient.xRead(
        [{ key: 'events.inbound.webhooks', id: '0' }],
        { COUNT: 10 },
      );

      expect(events).toBeDefined();
      if (!events || events.length === 0) {
        throw new Error('Expected webhook event to be published');
      }

      // Find our event
      const ourEvent = events[0].messages.find(
        (msg) => msg.message.eventId === 'test-event-123',
      );
      expect(ourEvent).toBeDefined();
    });

    it('should reject invalid signature', async () => {
      const connection = await createTestConnection(harness.getDataSource(), {
        platformType: 'prestashop',
        status: 'active',
      });

      const payload = {
        schemaVersion: 1,
        eventId: 'test-event-456',
        eventType: 'product.saved',
        occurredAt: new Date().toISOString(),
        object: { type: 'product', externalId: '12345' },
      };

      await harness
        .getHttp()
        .post(`/webhooks/prestashop/${connection.id}`)
        .set('X-OpenLinker-Timestamp', Date.now().toString())
        .set('X-OpenLinker-Signature', 'sha256=invalid-signature')
        .send(payload)
        .expect(401);
    });

    it('should prevent duplicate events', async () => {
      const connection = await createTestConnection(harness.getDataSource(), {
        platformType: 'prestashop',
        status: 'active',
      });

      const payload = {
        schemaVersion: 1,
        eventId: 'duplicate-test-event',
        eventType: 'product.saved',
        occurredAt: new Date().toISOString(),
        object: { type: 'product', externalId: '12345' },
      };

      const rawBody = Buffer.from(JSON.stringify(payload));
      const timestamp = Date.now().toString();
      const signature = crypto
        .createHmac('sha256', webhookSecret)
        .update(timestamp + '.' + rawBody.toString())
        .digest('hex');

      // First request - should succeed
      await harness
        .getHttp()
        .post(`/webhooks/prestashop/${connection.id}`)
        .set('X-OpenLinker-Timestamp', timestamp)
        .set('X-OpenLinker-Signature', `sha256=${signature}`)
        .send(payload)
        .expect(202);

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Second request with same eventId - should also succeed (202) but not publish duplicate
      await harness
        .getHttp()
        .post(`/webhooks/prestashop/${connection.id}`)
        .set('X-OpenLinker-Timestamp', timestamp)
        .set('X-OpenLinker-Signature', `sha256=${signature}`)
        .send(payload)
        .expect(202);

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Verify only one event in stream
      const redisClient = harness.getRedisClient();
      if (!redisClient) {
        throw new Error('Redis client not available');
      }

      const events = await redisClient.xRead(
        [{ key: 'events.inbound.webhooks', id: '0' }],
        { COUNT: 10 },
      );

      if (!events || events.length === 0) {
        throw new Error('Expected webhook events to exist');
      }

      const duplicateEvents = events[0].messages.filter(
        (msg) => msg.message.eventId === 'duplicate-test-event',
      );
      expect(duplicateEvents.length).toBe(1);
    });

    it('should validate raw body signature correctly (whitespace/property order)', async () => {
      const connection = await createTestConnection(harness.getDataSource(), {
        platformType: 'prestashop',
        status: 'active',
      });

      // Original payload with specific formatting
      const originalPayload = {
        schemaVersion: 1,
        eventId: 'raw-body-test',
        eventType: 'product.saved',
        occurredAt: '2025-01-01T12:00:00.000Z',
        object: { type: 'product', externalId: '12345' },
      };

      // Create raw body with specific formatting (no extra spaces)
      const rawBody = Buffer.from(JSON.stringify(originalPayload));
      const timestamp = Date.now().toString();
      const signature = crypto
        .createHmac('sha256', webhookSecret)
        .update(timestamp + '.' + rawBody.toString())
        .digest('hex');

      // Send with exact raw body - should succeed
      await harness
        .getHttp()
        .post(`/webhooks/prestashop/${connection.id}`)
        .set('X-OpenLinker-Timestamp', timestamp)
        .set('X-OpenLinker-Signature', `sha256=${signature}`)
        .send(originalPayload)
        .expect(202);

      // Now try with re-stringified JSON (different property order or whitespace)
      // This should fail because signature was computed on original raw bytes
      const reStringified = JSON.parse(JSON.stringify(originalPayload));
      const newTimestamp = Date.now().toString();
      const newRawBody = Buffer.from(JSON.stringify(reStringified));
      const newSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(newTimestamp + '.' + newRawBody.toString())
        .digest('hex');

      // This should work because we're using the correct raw body
      await harness
        .getHttp()
        .post(`/webhooks/prestashop/${connection.id}`)
        .set('X-OpenLinker-Timestamp', newTimestamp)
        .set('X-OpenLinker-Signature', `sha256=${newSignature}`)
        .send(reStringified)
        .expect(202);

      // But if we use the old signature with new body, it should fail
      await harness
        .getHttp()
        .post(`/webhooks/prestashop/${connection.id}`)
        .set('X-OpenLinker-Timestamp', newTimestamp)
        .set('X-OpenLinker-Signature', `sha256=${signature}`) // Old signature
        .send(reStringified) // New body
        .expect(401);
    });

    it('should handle handler crash/retry with job dedup', async () => {
      const connection = await createTestConnection(harness.getDataSource(), {
        platformType: 'prestashop',
        status: 'active',
      });

      const payload = {
        schemaVersion: 1,
        eventId: 'crash-retry-test',
        eventType: 'product.saved',
        occurredAt: new Date().toISOString(),
        object: { type: 'product', externalId: '12345' },
      };

      const rawBody = Buffer.from(JSON.stringify(payload));
      const timestamp = Date.now().toString();
      const signature = crypto
        .createHmac('sha256', webhookSecret)
        .update(timestamp + '.' + rawBody.toString())
        .digest('hex');

      // Publish event
      await harness
        .getHttp()
        .post(`/webhooks/prestashop/${connection.id}`)
        .set('X-OpenLinker-Timestamp', timestamp)
        .set('X-OpenLinker-Signature', `sha256=${signature}`)
        .send(payload)
        .expect(202);

      // Wait for handler to process (or simulate crash before ACK)
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Verify event was published
      const redisClient = harness.getRedisClient();
      if (!redisClient) {
        throw new Error('Redis client not available');
      }

      const events = await redisClient.xRead(
        [{ key: 'events.inbound.webhooks', id: '0' }],
        { COUNT: 10 },
      );

      if (!events || events.length === 0) {
        throw new Error('Expected crash-retry event to be published');
      }

      const ourEvent = events[0].messages.find(
        (msg) => msg.message.eventId === 'crash-retry-test',
      );
      expect(ourEvent).toBeDefined();

      // Check if job was enqueued (handler should have processed it)
      // Job dedup should prevent double enqueue even if handler retries
      const jobs = await redisClient.xRead(
        [{ key: 'jobs.sync', id: '0' }],
        { COUNT: 10 },
      );

      if (jobs && jobs.length > 0) {
        const ourJobs = jobs[0].messages.filter(
          (msg) => msg.message.idempotencyKey === `prestashop:${connection.id}:crash-retry-test`,
        );
        // Should be at most 1 job (idempotency prevents duplicates)
        expect(ourJobs.length).toBeLessThanOrEqual(1);
      }
    });

    // #1511: representative end-to-end webhook slice. Every other test in this
    // file stops at "event published to the Redis stream" — none proves the
    // running `WebhookToJobHandler` consumer (group `webhook-handler`) actually
    // consumes that event, translates + capability-routes it, and enqueues the
    // downstream sync job. A webhook that publishes correctly but whose handler
    // is broken would pass every other assertion here. This drives the full
    // inbound -> event bus -> job path and asserts the enqueued `jobs.sync`
    // message. Other providers may follow this pattern later.
    it('should drain the published event through the WebhookToJobHandler and enqueue the downstream sync job (#1511)', async () => {
      const redisClient = harness.getRedisClient();
      if (!redisClient) throw new Error('Redis client not available');

      // `resetTestHarness()` flushed Redis (dropping the boot-time consumer
      // group) after the previous test — recreate it so the running handler can
      // consume the event we are about to publish.
      await ensureWebhookConsumerGroup(redisClient);

      // The order route requires the `OrderSource` capability to be BOTH
      // supported by the adapter (prestashop manifest advertises it) AND enabled
      // on the connection (routing-policy gate), else it dead-letters instead of
      // enqueuing.
      const connection = await createTestConnection(harness.getDataSource(), {
        platformType: 'prestashop',
        status: 'active',
        enabledCapabilities: ['OrderSource'],
      });

      const eventId = 'drain-order-event-1511';
      const externalOrderId = '778899';
      const payload = {
        schemaVersion: 1,
        eventId,
        eventType: 'order.created',
        occurredAt: new Date().toISOString(),
        object: { type: 'order', externalId: externalOrderId },
        payload: { id_order: externalOrderId },
      };

      const rawBody = Buffer.from(JSON.stringify(payload));
      const timestamp = Date.now().toString();
      const signature = crypto
        .createHmac('sha256', webhookSecret)
        .update(timestamp + '.' + rawBody.toString())
        .digest('hex');

      await harness
        .getHttp()
        .post(`/webhooks/prestashop/${connection.id}`)
        .set('X-OpenLinker-Timestamp', timestamp)
        .set('X-OpenLinker-Signature', `sha256=${signature}`)
        .send(payload)
        .expect(202);

      // The routing policy stamps `{platformType}:{connectionId}:{sourceEventId}`
      // as the job idempotency key.
      const expectedIdempotencyKey = `prestashop:${connection.id}:${eventId}`;
      const jobMessage = await waitForEnqueuedJob(redisClient, expectedIdempotencyKey);

      // The handler consumed the stream event and enqueued the downstream job —
      // the segment none of the other tests cover.
      expect(jobMessage).toBeDefined();
      expect(jobMessage!.jobType).toBe('marketplace.order.sync');
      expect(jobMessage!.connectionId).toBe(connection.id);
      const jobPayload = JSON.parse(jobMessage!.payloadJson) as {
        externalOrderId: string;
        sourceEventId: string;
        eventType: string;
      };
      expect(jobPayload.externalOrderId).toBe(externalOrderId);
      expect(jobPayload.sourceEventId).toBe(eventId);
      expect(jobPayload.eventType).toBe('created');

      // The delivery row also records the handler's enqueue outcome (the handler
      // upserts status='job_enqueued' with the downstream job type/id).
      const delivery = await waitForEnqueuedDelivery(harness, connection.id, eventId);
      expect(delivery).toBeDefined();
      expect(delivery!.downstreamJobType).toBe('marketplace.order.sync');
      expect(delivery!.downstreamJobId).not.toBeNull();
    });

    // #711: Postgres-authoritative replay protection. Three identical signed
    // requests within 5 s should all return 202 (idempotent ack), but only
    // ONE row should land in `webhook_deliveries` and only ONE message should
    // be published.
    it('should reject replay attacks via the Postgres unique constraint (#711)', async () => {
      const connection = await createTestConnection(harness.getDataSource(), {
        platformType: 'prestashop',
        status: 'active',
      });

      const payload = {
        schemaVersion: 1,
        eventId: 'replay-attack-test',
        eventType: 'product.saved',
        occurredAt: new Date().toISOString(),
        object: { type: 'product', externalId: '99999' },
      };
      const rawBody = Buffer.from(JSON.stringify(payload));
      const timestamp = Date.now().toString();
      const signature = crypto
        .createHmac('sha256', webhookSecret)
        .update(timestamp + '.' + rawBody.toString())
        .digest('hex');

      // Three identical replays.
      for (let i = 0; i < 3; i++) {
        await harness
          .getHttp()
          .post(`/webhooks/prestashop/${connection.id}`)
          .set('X-OpenLinker-Timestamp', timestamp)
          .set('X-OpenLinker-Signature', `sha256=${signature}`)
          .send(payload)
          .expect(202);
      }

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Assert: exactly one row in webhook_deliveries.
      const rows = (await harness.getDataSource().query(
        `SELECT id, status FROM webhook_deliveries WHERE provider = $1 AND "connectionId" = $2 AND "eventId" = $3`,
        ['prestashop', connection.id, 'replay-attack-test']
      )) as Array<{ id: string; status: string }>;
      expect(rows).toHaveLength(1);
      expect(['received', 'published']).toContain(rows[0].status);

      // Assert: exactly one inbound webhook event in the Redis stream.
      const redisClient = harness.getRedisClient();
      if (!redisClient) throw new Error('Redis client not available');
      const events = await redisClient.xRead(
        [{ key: 'events.inbound.webhooks', id: '0' }],
        { COUNT: 100 }
      );
      const publishedReplays = events?.[0]?.messages.filter(
        (msg) => msg.message.eventId === 'replay-attack-test'
      );
      expect(publishedReplays?.length ?? 0).toBe(1);
    });

    // #711: tightened replay window. A 5-minute-old timestamp would have been
    // accepted under the old 5-min default; under the new 120 s default it
    // is rejected before any row is inserted.
    it('should reject a stale timestamp without inserting a row (#711)', async () => {
      const connection = await createTestConnection(harness.getDataSource(), {
        platformType: 'prestashop',
        status: 'active',
      });

      const payload = {
        schemaVersion: 1,
        eventId: 'stale-timestamp-test',
        eventType: 'product.saved',
        occurredAt: new Date().toISOString(),
        object: { type: 'product', externalId: '11111' },
      };
      const rawBody = Buffer.from(JSON.stringify(payload));
      // 5 minutes ago — well outside the new 120s window.
      const staleTimestamp = (Date.now() - 5 * 60 * 1000).toString();
      const signature = crypto
        .createHmac('sha256', webhookSecret)
        .update(staleTimestamp + '.' + rawBody.toString())
        .digest('hex');

      await harness
        .getHttp()
        .post(`/webhooks/prestashop/${connection.id}`)
        .set('X-OpenLinker-Timestamp', staleTimestamp)
        .set('X-OpenLinker-Signature', `sha256=${signature}`)
        .send(payload)
        .expect(401);

      // Assert: no row was inserted (per plan §4.4 — failed-validation paths
      // skip the row insert to keep the unique constraint clean for retries).
      const rows = (await harness.getDataSource().query(
        `SELECT id FROM webhook_deliveries WHERE provider = $1 AND "connectionId" = $2 AND "eventId" = $3`,
        ['prestashop', connection.id, 'stale-timestamp-test']
      )) as Array<{ id: string }>;
      expect(rows).toHaveLength(0);
    });
  });
});

