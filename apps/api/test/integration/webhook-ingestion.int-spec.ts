/**
 * Webhook Ingestion Integration Tests
 *
 * Integration tests for the durable webhook spine (#2280, ADR-049 decision 1):
 * signature verification, ingress routing, and the single-transaction gate that
 * commits the `webhook_deliveries` row and the `sync_jobs` work row together.
 * Redis is asserted to be OUT of the durable path — no `jobs.sync` stream
 * entry, no `jobdedup:*` key, and a wiped Redis neither loses a webhook nor
 * lets a redelivery double-enqueue. The one-shot `LegacyInboundWebhookDrain`
 * is exercised against a seeded pre-upgrade backlog. (The Redis-hard-down
 * ingress case is unit-covered in `webhook.service.spec.ts` — stopping the
 * shared Testcontainer here would poison sibling suites.)
 *
 * @module apps/api/test/integration
 */
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { IntegrationTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import { LegacyInboundWebhookDrain } from '../../src/webhooks/application/handlers/legacy-inbound-webhook-drain';
import * as crypto from 'crypto';

const INBOUND_WEBHOOK_STREAM = 'events.inbound.webhooks';
const WEBHOOK_HANDLER_CONSUMER_GROUP = 'webhook-handler';
const JOBS_SYNC_STREAM = 'jobs.sync';

interface WebhookDeliveryRow {
  status: string;
  downstreamJobType: string | null;
  downstreamJobId: string | null;
  dlqReason: string | null;
}

interface SyncJobRow {
  id: string;
  jobType: string;
  status: string;
  connectionId: string;
  payloadJson: unknown;
}

/** `payloadJson` is jsonb — the driver returns it parsed; tolerate both. */
function parseJobPayload<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

async function readDeliveryRow(
  harness: IntegrationTestHarness,
  connectionId: string,
  eventId: string,
): Promise<WebhookDeliveryRow | undefined> {
  const rows = (await harness.getDataSource().query(
    `SELECT status, "downstreamJobType", "downstreamJobId", "dlqReason"
       FROM webhook_deliveries
      WHERE provider = $1 AND "connectionId" = $2 AND "eventId" = $3`,
    ['prestashop', connectionId, eventId],
  )) as WebhookDeliveryRow[];
  return rows[0];
}

async function readJobRows(
  harness: IntegrationTestHarness,
  idempotencyKey: string,
): Promise<SyncJobRow[]> {
  return (await harness.getDataSource().query(
    `SELECT id, "jobType", status, "connectionId", "payloadJson"
       FROM sync_jobs WHERE "idempotencyKey" = $1`,
    [idempotencyKey],
  )) as SyncJobRow[];
}

function signedRequest(payload: object, secret: string): {
  timestamp: string;
  signature: string;
} {
  const rawBody = Buffer.from(JSON.stringify(payload));
  const timestamp = Date.now().toString();
  const signature = crypto
    .createHmac('sha256', secret)
    .update(timestamp + '.' + rawBody.toString())
    .digest('hex');
  return { timestamp, signature };
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
    it('commits the sync_jobs work row and the delivery row together, with no Redis job artefacts (#2280)', async () => {
      const connection = await createTestConnection(harness.getDataSource(), {
        platformType: 'prestashop',
        status: 'active',
        enabledCapabilities: ['ProductMaster'],
      });

      const eventId = 'spine-routed-event-1';
      const payload = {
        schemaVersion: 1,
        eventId,
        eventType: 'product.saved',
        occurredAt: new Date().toISOString(),
        object: { type: 'product', externalId: '12345' },
        payload: { name: 'Test Product' },
      };
      const { timestamp, signature } = signedRequest(payload, webhookSecret);

      await harness
        .getHttp()
        .post(`/webhooks/prestashop/${connection.id}`)
        .set('X-OpenLinker-Timestamp', timestamp)
        .set('X-OpenLinker-Signature', `sha256=${signature}`)
        .send(payload)
        .expect(202);

      // The gate is synchronous — no polling: by the time the 202 returns, both
      // rows are committed.
      const idempotencyKey = `prestashop:${connection.id}:${eventId}`;
      const jobs = await readJobRows(harness, idempotencyKey);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].jobType).toBe('master.product.syncByExternalId');
      expect(jobs[0].status).toBe('queued');
      expect(jobs[0].connectionId).toBe(connection.id);

      const delivery = await readDeliveryRow(harness, connection.id, eventId);
      expect(delivery).toBeDefined();
      expect(delivery!.status).toBe('job_enqueued');
      expect(delivery!.downstreamJobType).toBe('master.product.syncByExternalId');
      expect(delivery!.downstreamJobId).toBe(jobs[0].id);

      // Redis carries no part of the durable path: no jobs.sync stream entry,
      // no jobdedup reservation, no inbound-webhook stream entry.
      const redisClient = harness.getRedisClient();
      if (!redisClient) throw new Error('Redis client not available');
      const streamJobs = await redisClient.xRead([{ key: JOBS_SYNC_STREAM, id: '0' }], {
        COUNT: 100,
      });
      const streamedJob = streamJobs?.[0]?.messages.find(
        (msg) => msg.message.idempotencyKey === idempotencyKey,
      );
      expect(streamedJob).toBeUndefined();
      expect(await redisClient.exists(`jobdedup:${idempotencyKey}`)).toBe(0);
      const inbound = await redisClient.xRead([{ key: INBOUND_WEBHOOK_STREAM, id: '0' }], {
        COUNT: 100,
      });
      const inboundEntry = inbound?.[0]?.messages.find((msg) => msg.message.eventId === eventId);
      expect(inboundEntry).toBeUndefined();
    });

    it('routes an order webhook to marketplace.order.sync with the translated payload (#1511 successor)', async () => {
      const connection = await createTestConnection(harness.getDataSource(), {
        platformType: 'prestashop',
        status: 'active',
        enabledCapabilities: ['OrderSource'],
      });

      const eventId = 'spine-order-event-1511';
      const externalOrderId = '778899';
      const payload = {
        schemaVersion: 1,
        eventId,
        eventType: 'order.created',
        occurredAt: new Date().toISOString(),
        object: { type: 'order', externalId: externalOrderId },
        payload: { id_order: externalOrderId },
      };
      const { timestamp, signature } = signedRequest(payload, webhookSecret);

      await harness
        .getHttp()
        .post(`/webhooks/prestashop/${connection.id}`)
        .set('X-OpenLinker-Timestamp', timestamp)
        .set('X-OpenLinker-Signature', `sha256=${signature}`)
        .send(payload)
        .expect(202);

      const jobs = await readJobRows(harness, `prestashop:${connection.id}:${eventId}`);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].jobType).toBe('marketplace.order.sync');
      const jobPayload = parseJobPayload<{
        externalOrderId: string;
        sourceEventId: string;
        eventType: string;
      }>(jobs[0].payloadJson);
      expect(jobPayload.externalOrderId).toBe(externalOrderId);
      expect(jobPayload.sourceEventId).toBe(eventId);
      expect(jobPayload.eventType).toBe('created');

      const delivery = await readDeliveryRow(harness, connection.id, eventId);
      expect(delivery!.status).toBe('job_enqueued');
      expect(delivery!.downstreamJobId).toBe(jobs[0].id);
    });

    it('records a capability-ungated event as a durable deadlettered row with no job', async () => {
      // Default connection: enabledCapabilities [] — product.saved needs
      // ProductMaster, so routing classifies it unroutable (durable row, not a
      // Redis DLQ entry).
      const connection = await createTestConnection(harness.getDataSource(), {
        platformType: 'prestashop',
        status: 'active',
      });

      const eventId = 'spine-ungated-event-1';
      const payload = {
        schemaVersion: 1,
        eventId,
        eventType: 'product.saved',
        occurredAt: new Date().toISOString(),
        object: { type: 'product', externalId: '12345' },
      };
      const { timestamp, signature } = signedRequest(payload, webhookSecret);

      await harness
        .getHttp()
        .post(`/webhooks/prestashop/${connection.id}`)
        .set('X-OpenLinker-Timestamp', timestamp)
        .set('X-OpenLinker-Signature', `sha256=${signature}`)
        .send(payload)
        .expect(202);

      const delivery = await readDeliveryRow(harness, connection.id, eventId);
      expect(delivery).toBeDefined();
      expect(delivery!.status).toBe('deadlettered');
      expect(delivery!.dlqReason).toContain('ungated');
      const jobs = await readJobRows(harness, `prestashop:${connection.id}:${eventId}`);
      expect(jobs).toHaveLength(0);
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

    it('dedups a same-event redelivery on the Postgres gate: one delivery row, one job row', async () => {
      const connection = await createTestConnection(harness.getDataSource(), {
        platformType: 'prestashop',
        status: 'active',
        enabledCapabilities: ['ProductMaster'],
      });

      const eventId = 'duplicate-test-event';
      const payload = {
        schemaVersion: 1,
        eventId,
        eventType: 'product.saved',
        occurredAt: new Date().toISOString(),
        object: { type: 'product', externalId: '12345' },
      };
      const { timestamp, signature } = signedRequest(payload, webhookSecret);

      for (let i = 0; i < 2; i++) {
        await harness
          .getHttp()
          .post(`/webhooks/prestashop/${connection.id}`)
          .set('X-OpenLinker-Timestamp', timestamp)
          .set('X-OpenLinker-Signature', `sha256=${signature}`)
          .send(payload)
          .expect(202);
      }

      const rows = (await harness.getDataSource().query(
        `SELECT id FROM webhook_deliveries WHERE provider = $1 AND "connectionId" = $2 AND "eventId" = $3`,
        ['prestashop', connection.id, eventId],
      )) as Array<{ id: string }>;
      expect(rows).toHaveLength(1);
      const jobs = await readJobRows(harness, `prestashop:${connection.id}:${eventId}`);
      expect(jobs).toHaveLength(1);
    });

    it('survives a Redis wipe between deliveries: the Postgres gate still dedups and no second job is created (#2280)', async () => {
      const connection = await createTestConnection(harness.getDataSource(), {
        platformType: 'prestashop',
        status: 'active',
        enabledCapabilities: ['ProductMaster'],
      });

      const eventId = 'redis-wipe-event-1';
      const payload = {
        schemaVersion: 1,
        eventId,
        eventType: 'product.saved',
        occurredAt: new Date().toISOString(),
        object: { type: 'product', externalId: '12345' },
      };
      const { timestamp, signature } = signedRequest(payload, webhookSecret);

      await harness
        .getHttp()
        .post(`/webhooks/prestashop/${connection.id}`)
        .set('X-OpenLinker-Timestamp', timestamp)
        .set('X-OpenLinker-Signature', `sha256=${signature}`)
        .send(payload)
        .expect(202);

      // Wipe Redis — the pre-#2280 flow would lose its inner dedup marks here;
      // the durable spine must not care.
      const redisClient = harness.getRedisClient();
      if (!redisClient) throw new Error('Redis client not available');
      await redisClient.flushDb();

      await harness
        .getHttp()
        .post(`/webhooks/prestashop/${connection.id}`)
        .set('X-OpenLinker-Timestamp', timestamp)
        .set('X-OpenLinker-Signature', `sha256=${signature}`)
        .send(payload)
        .expect(202);

      const jobs = await readJobRows(harness, `prestashop:${connection.id}:${eventId}`);
      expect(jobs).toHaveLength(1);
      const rows = (await harness.getDataSource().query(
        `SELECT id FROM webhook_deliveries WHERE provider = $1 AND "connectionId" = $2 AND "eventId" = $3`,
        ['prestashop', connection.id, eventId],
      )) as Array<{ id: string }>;
      expect(rows).toHaveLength(1);
    });

    it('should validate raw body signature correctly (whitespace/property order)', async () => {
      const connection = await createTestConnection(harness.getDataSource(), {
        platformType: 'prestashop',
        status: 'active',
      });

      const originalPayload = {
        schemaVersion: 1,
        eventId: 'raw-body-test',
        eventType: 'product.saved',
        occurredAt: '2025-01-01T12:00:00.000Z',
        object: { type: 'product', externalId: '12345' },
      };

      const { timestamp, signature } = signedRequest(originalPayload, webhookSecret);

      await harness
        .getHttp()
        .post(`/webhooks/prestashop/${connection.id}`)
        .set('X-OpenLinker-Timestamp', timestamp)
        .set('X-OpenLinker-Signature', `sha256=${signature}`)
        .send(originalPayload)
        .expect(202);

      const reStringified = JSON.parse(JSON.stringify(originalPayload));
      const { timestamp: newTimestamp, signature: newSignature } = signedRequest(
        reStringified,
        webhookSecret,
      );

      await harness
        .getHttp()
        .post(`/webhooks/prestashop/${connection.id}`)
        .set('X-OpenLinker-Timestamp', newTimestamp)
        .set('X-OpenLinker-Signature', `sha256=${newSignature}`)
        .send(reStringified)
        .expect(202);

      // Old signature with a new timestamp must fail — signature covers the
      // timestamp + raw bytes.
      await harness
        .getHttp()
        .post(`/webhooks/prestashop/${connection.id}`)
        .set('X-OpenLinker-Timestamp', Date.now().toString())
        .set('X-OpenLinker-Signature', `sha256=${signature}`)
        .send(reStringified)
        .expect(401);
    });

    // #711: Postgres-authoritative replay protection — three identical signed
    // requests all 202, one delivery row, one job row.
    it('should reject replay attacks via the Postgres unique constraint (#711)', async () => {
      const connection = await createTestConnection(harness.getDataSource(), {
        platformType: 'prestashop',
        status: 'active',
        enabledCapabilities: ['ProductMaster'],
      });

      const eventId = 'replay-attack-test';
      const payload = {
        schemaVersion: 1,
        eventId,
        eventType: 'product.saved',
        occurredAt: new Date().toISOString(),
        object: { type: 'product', externalId: '99999' },
      };
      const { timestamp, signature } = signedRequest(payload, webhookSecret);

      for (let i = 0; i < 3; i++) {
        await harness
          .getHttp()
          .post(`/webhooks/prestashop/${connection.id}`)
          .set('X-OpenLinker-Timestamp', timestamp)
          .set('X-OpenLinker-Signature', `sha256=${signature}`)
          .send(payload)
          .expect(202);
      }

      const rows = (await harness.getDataSource().query(
        `SELECT id, status FROM webhook_deliveries WHERE provider = $1 AND "connectionId" = $2 AND "eventId" = $3`,
        ['prestashop', connection.id, eventId],
      )) as Array<{ id: string; status: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('job_enqueued');
      const jobs = await readJobRows(harness, `prestashop:${connection.id}:${eventId}`);
      expect(jobs).toHaveLength(1);
    });

    // #711: tightened replay window — a stale timestamp is rejected before any
    // row is inserted.
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

      const rows = (await harness.getDataSource().query(
        `SELECT id FROM webhook_deliveries WHERE provider = $1 AND "connectionId" = $2 AND "eventId" = $3`,
        ['prestashop', connection.id, 'stale-timestamp-test'],
      )) as Array<{ id: string }>;
      expect(rows).toHaveLength(0);
    });
  });

  describe('LegacyInboundWebhookDrain (upgrade backlog, #2280)', () => {
    it('drains a pre-upgrade stream entry: creates the job and advances the legacy published row', async () => {
      const redisClient = harness.getRedisClient();
      if (!redisClient) throw new Error('Redis client not available');

      const connection = await createTestConnection(harness.getDataSource(), {
        platformType: 'prestashop',
        status: 'active',
        enabledCapabilities: ['OrderSource'],
      });

      const eventId = 'legacy-drain-event-1';
      const externalOrderId = '445566';
      const now = new Date();

      // Recreate the pre-upgrade state: the consumer group anchored at '0' (so
      // the seeded entry is unread), a stream entry the retired publisher
      // wrote, and a delivery row stuck at 'published' with no job.
      try {
        await redisClient.xGroupCreate(INBOUND_WEBHOOK_STREAM, WEBHOOK_HANDLER_CONSUMER_GROUP, '0', {
          MKSTREAM: true,
        });
      } catch (error) {
        if (!(error instanceof Error && error.message.includes('BUSYGROUP'))) throw error;
      }
      await harness.getDataSource().query(
        `INSERT INTO webhook_deliveries
           ("eventId", "provider", "connectionId", "status", "receivedAt", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'published', $4, now(), now())`,
        [eventId, 'prestashop', connection.id, now],
      );
      await redisClient.xAdd(INBOUND_WEBHOOK_STREAM, '*', {
        eventId,
        eventType: 'inbound.webhook.order.created',
        payloadJson: JSON.stringify({
          objectType: 'order',
          externalId: externalOrderId,
          payload: { id_order: externalOrderId },
        }),
        metadataJson: JSON.stringify({ provider: 'prestashop', connectionId: connection.id }),
        occurredAt: now.toISOString(),
        publishedAt: now.toISOString(),
      });

      // Re-trigger the one-shot drain (its boot run happened before this
      // seed). `onModuleInit` detaches deliberately so it cannot block boot,
      // so drive the drain body directly rather than racing a setImmediate.
      const drain = harness.getApp().get(LegacyInboundWebhookDrain) as unknown as {
        runDetachedDrain: () => Promise<void>;
      };
      await drain.runDetachedDrain();

      const jobs = await readJobRows(harness, `prestashop:${connection.id}:${eventId}`);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].jobType).toBe('marketplace.order.sync');

      const delivery = await readDeliveryRow(harness, connection.id, eventId);
      expect(delivery!.status).toBe('job_enqueued');
      expect(delivery!.downstreamJobId).toBe(jobs[0].id);

      // The drained entry is ACKed — a second drain run finds nothing new and
      // creates no second job.
      await drain.runDetachedDrain();
      const jobsAfter = await readJobRows(harness, `prestashop:${connection.id}:${eventId}`);
      expect(jobsAfter).toHaveLength(1);
    });
  });
});
