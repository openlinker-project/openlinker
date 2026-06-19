/**
 * Orders Read API Integration Test
 *
 * Vertical slice tests for the orders read API:
 * GET /orders — list with pagination and filters
 * GET /orders/:internalOrderId — detail view
 *
 * Uses real Postgres via Testcontainers.
 *
 * @module apps/api/test/integration
 */
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';
import { loginAsAdmin } from './helpers/test-auth.helper';
import { createTestOrderRecord } from './fixtures/order.fixtures';

describe('Orders Read API Integration', () => {
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

  describe('GET /orders', () => {
    it('should return empty list when no orders exist', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const response = await http
        .get('/orders')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.items).toEqual([]);
      expect(response.body.total).toBe(0);
    });

    it('should return seeded orders with correct shape', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const order = await createTestOrderRecord(dataSource);

      const response = await http
        .get('/orders')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.total).toBe(1);
      expect(response.body.items).toHaveLength(1);

      const item = response.body.items[0];
      expect(item.internalOrderId).toBe(order.internalOrderId);
      expect(item.sourceConnectionId).toBe(order.sourceConnectionId);
      expect(item.syncStatus).toBeDefined();
      expect(Array.isArray(item.syncStatus)).toBe(true);
    });

    it('should filter by sourceConnectionId', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const targetConnectionId = '11111111-1111-4111-8111-111111111111';
      const otherConnectionId = '99999999-9999-4999-8999-999999999999';

      await createTestOrderRecord(dataSource, { sourceConnectionId: targetConnectionId });
      await createTestOrderRecord(dataSource, { sourceConnectionId: otherConnectionId });

      const response = await http
        .get(`/orders?sourceConnectionId=${targetConnectionId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.total).toBe(1);
      expect(response.body.items[0].sourceConnectionId).toBe(targetConnectionId);
    });

    it('should filter by syncStatus', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      await createTestOrderRecord(dataSource, {
        syncStatus: [
          { destinationConnectionId: '00000000-0000-0000-0000-000000000002', status: 'synced' },
        ],
      });
      await createTestOrderRecord(dataSource, {
        syncStatus: [
          { destinationConnectionId: '00000000-0000-0000-0000-000000000002', status: 'failed' },
        ],
      });

      const response = await http
        .get('/orders?syncStatus=synced')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.total).toBe(1);
    });

    it('should paginate results with limit and offset', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      for (let i = 0; i < 5; i++) {
        await createTestOrderRecord(dataSource);
      }

      const page1 = await http
        .get('/orders?limit=2&offset=0')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(page1.body.items).toHaveLength(2);
      expect(page1.body.total).toBe(5);
      expect(page1.body.limit).toBe(2);
      expect(page1.body.offset).toBe(0);

      const page2 = await http
        .get('/orders?limit=2&offset=2')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(page2.body.items).toHaveLength(2);
      expect(page2.body.total).toBe(5);

      // Pages must not overlap
      const ids1 = page1.body.items.map(
        (o: { internalOrderId: string }) => o.internalOrderId
      ) as string[];
      const ids2 = page2.body.items.map(
        (o: { internalOrderId: string }) => o.internalOrderId
      ) as string[];
      expect(ids1.some((id) => ids2.includes(id))).toBe(false);
    });

    it('should return 401 without token', async () => {
      const http = harness.getHttp();
      await http.get('/orders').expect(401);
    });
  });

  // Ship-by SLA + fulfillment rollup (#1108) — exercises the new derived
  // `slaState` (BE-owned, single source of truth) + the denormalized
  // `fulfillmentState` column end-to-end through the migration + real DB.
  describe('GET /orders — ship-by SLA + fulfillment (#1108)', () => {
    it('should derive slaState=overdue and fulfillmentState=not-shipped for an overdue, unshipped order', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      await createTestOrderRecord(dataSource, { dispatchByAt: new Date(Date.now() - 60_000) });

      const response = await http
        .get('/orders')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // NULL fulfillment column surfaces as `not-shipped`; a past deadline + not
      // shipped derives `overdue`.
      expect(response.body.items[0].fulfillmentState).toBe('not-shipped');
      expect(response.body.items[0].slaState).toBe('overdue');
    });

    it('should clear slaState to none once the order has shipped', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      // Past deadline, but already dispatched → SLA pressure cleared.
      await createTestOrderRecord(dataSource, {
        dispatchByAt: new Date(Date.now() - 60_000),
        fulfillmentState: 'dispatched',
      });

      const response = await http
        .get('/orders')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.items[0].fulfillmentState).toBe('dispatched');
      expect(response.body.items[0].slaState).toBe('none');
    });

    it('should filter by slaState and fulfillmentState', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      await createTestOrderRecord(dataSource, { dispatchByAt: new Date(Date.now() - 60_000) });
      await createTestOrderRecord(dataSource, { fulfillmentState: 'dispatched' });

      const overdue = await http
        .get('/orders?slaState=overdue')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(overdue.body.total).toBe(1);
      expect(overdue.body.items[0].slaState).toBe('overdue');

      const dispatched = await http
        .get('/orders?fulfillmentState=dispatched')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(dispatched.body.total).toBe(1);
      expect(dispatched.body.items[0].fulfillmentState).toBe('dispatched');

      // not-shipped also matches NULL-column rows.
      const notShipped = await http
        .get('/orders?fulfillmentState=not-shipped')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(notShipped.body.total).toBe(1);
    });

    it('should partition the set in GET /orders/sla-summary', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      await createTestOrderRecord(dataSource, { dispatchByAt: new Date(Date.now() - 60_000) });
      await createTestOrderRecord(dataSource, { fulfillmentState: 'delivered' });
      await createTestOrderRecord(dataSource, {});

      const response = await http
        .get('/orders/sla-summary')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.total).toBe(3);
      expect(response.body.overdue).toBe(1);
      // delivered (shipped) + no-deadline → none.
      expect(response.body.none).toBe(2);
      expect(
        response.body.onTrack +
          response.body.atRisk +
          response.body.overdue +
          response.body.none,
      ).toBe(response.body.total);
    });
  });

  describe('GET /orders/:internalOrderId', () => {
    it('should return order detail by internal order id', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const order = await createTestOrderRecord(dataSource);

      const response = await http
        .get(`/orders/${order.internalOrderId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.internalOrderId).toBe(order.internalOrderId);
      expect(response.body.sourceConnectionId).toBe(order.sourceConnectionId);
    });

    it('should return 404 for non-existent order', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      await http
        .get('/orders/ol_order_nonexistent')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('should return 401 without token', async () => {
      const http = harness.getHttp();
      await http.get('/orders/ol_order_nonexistent').expect(401);
    });
  });
});
