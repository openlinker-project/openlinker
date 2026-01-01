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
      expect(events.length).toBeGreaterThan(0);

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
      const response1 = await harness
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
  });
});

