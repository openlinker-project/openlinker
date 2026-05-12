/**
 * Order Destination Retry Integration Test
 *
 * Vertical slice for `POST /orders/:internalOrderId/destinations/:connectionId/retry`.
 * Verifies wiring through the controller → service → identifier mapping →
 * sync-job repository against real Postgres + Redis.
 *
 * @module apps/api/test/integration
 */
import { getTestHarness, IntegrationTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { loginAsAdmin } from './helpers/test-auth.helper';
import { createTestOrderRecord } from './fixtures/order.fixtures';
import { createTestConnection } from './helpers/test-connection.helper';
import { IdentifierMappingOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';

describe('Order Destination Retry Integration', () => {
  let harness: IntegrationTestHarness;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('should accept retry, claim the slot, and enqueue a marketplace.order.sync job (202)', async () => {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const redis = harness.getRedisClient();
    if (!redis) {
      throw new Error('Redis client unavailable in test harness');
    }
    const token = await loginAsAdmin(http, dataSource);

    const sourceConnection = await createTestConnection(dataSource, {
      platformType: 'allegro',
      name: 'Allegro Source',
      adapterKey: 'allegro.publicapi.v1',
    });
    const destConnection = await createTestConnection(dataSource, {
      name: 'PrestaShop Dest',
    });

    const orderRecord = await createTestOrderRecord(dataSource, {
      sourceConnectionId: sourceConnection.id,
      sourceEventId: 'evt-99',
      syncStatus: [
        {
          destinationConnectionId: destConnection.id,
          status: 'failed',
          error: 'PrestaShop country PL not active',
        },
      ],
    });

    // Seed the source-side identifier mapping so the service can resolve externalOrderId.
    const mappingRepo = dataSource.getRepository(IdentifierMappingOrmEntity);
    await mappingRepo.save(
      mappingRepo.create({
        entityType: 'Order',
        internalId: orderRecord.internalOrderId,
        externalId: 'allegro-order-1',
        platformType: 'allegro',
        connectionId: sourceConnection.id,
      }),
    );

    const response = await http
      .post(`/orders/${orderRecord.internalOrderId}/destinations/${destConnection.id}/retry`)
      .set('Authorization', `Bearer ${token}`)
      .expect(202);

    expect(response.body).toMatchObject({
      internalOrderId: orderRecord.internalOrderId,
      destinationConnectionId: destConnection.id,
      jobType: 'marketplace.order.sync',
    });
    expect(typeof response.body.jobId).toBe('string');

    // Verify a message landed on the Redis stream that workers consume.
    const streamLen = await redis.xLen('jobs.sync');
    expect(streamLen).toBeGreaterThanOrEqual(1);

    // The idempotency key was stored with the expected shape.
    const expectedKeyPattern = `jobdedup:marketplace:${sourceConnection.id}:order:evt-99:retry:`;
    const keys = await redis.keys(`${expectedKeyPattern}*`);
    expect(keys).toHaveLength(1);

    // Order row's destination flipped from 'failed' → 'pending'
    const detail = await http
      .get(`/orders/${orderRecord.internalOrderId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const row = detail.body.syncStatus.find(
      (s: { destinationConnectionId: string }) => s.destinationConnectionId === destConnection.id,
    );
    expect(row?.status).toBe('pending');
  });

  it('should reject with 409 when the destination is not in failed state', async () => {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const redis = harness.getRedisClient();
    if (!redis) {
      throw new Error('Redis client unavailable in test harness');
    }
    const token = await loginAsAdmin(http, dataSource);

    const sourceConnection = await createTestConnection(dataSource, {
      platformType: 'allegro',
      name: 'Allegro Source',
      adapterKey: 'allegro.publicapi.v1',
    });
    const destConnection = await createTestConnection(dataSource, { name: 'PrestaShop Dest' });

    const orderRecord = await createTestOrderRecord(dataSource, {
      sourceConnectionId: sourceConnection.id,
      sourceEventId: 'evt-100',
      syncStatus: [
        {
          destinationConnectionId: destConnection.id,
          status: 'synced',
          syncedAt: new Date().toISOString(),
          externalOrderId: 'PS-123',
        },
      ],
    });

    await http
      .post(`/orders/${orderRecord.internalOrderId}/destinations/${destConnection.id}/retry`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);

    // No message published to the queue
    const streamLen = await redis.xLen('jobs.sync').catch(() => 0);
    expect(streamLen).toBe(0);
  });

  it('should return 404 for an unknown order', async () => {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const token = await loginAsAdmin(http, dataSource);

    const unknownConnectionId = '99999999-9999-4999-8999-999999999999';

    await http
      .post(`/orders/ol_order_does_not_exist/destinations/${unknownConnectionId}/retry`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('should return 401 without token', async () => {
    const http = harness.getHttp();
    const unknownConnectionId = '99999999-9999-4999-8999-999999999999';

    await http
      .post(`/orders/ol_order_x/destinations/${unknownConnectionId}/retry`)
      .expect(401);
  });
});
