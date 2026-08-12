/**
 * Refund Record CRUD Integration Test (#2036)
 *
 * Full HTTP → Controller → Service → Repository → Database round trip for
 * capturing a return/refund/withdrawal against an order.
 *
 * @module apps/api/test/integration/orders
 */
import { RefundRecordOrmEntity } from '@openlinker/core/orders/orm-entities';
import { getTestHarness, resetTestHarness, teardownTestHarness } from '../setup';
import type { IntegrationTestHarness } from '../setup';
import { loginAsAdmin } from '../helpers/test-auth.helper';
import { createTestOrderRecord } from '../fixtures/order.fixtures';

interface RefundRecordResponseBody {
  id: string;
  internalOrderId: string;
  amount: string;
  currency: string;
  reason: string;
  note: string | null;
}

describe('Refund Record CRUD Integration', () => {
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

  it('should record a refund against an existing order and persist it', async () => {
    const order = await createTestOrderRecord(harness.getDataSource());
    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());

    const response = await http
      .post(`/v1/orders/${order.internalOrderId}/refunds`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: '49.99', currency: 'PLN', reason: 'withdrawal', note: 'buyer withdrew' })
      .expect(201);
    const body = response.body as RefundRecordResponseBody;

    expect(body).toMatchObject({
      internalOrderId: order.internalOrderId,
      amount: '49.99',
      currency: 'PLN',
      reason: 'withdrawal',
      note: 'buyer withdrew',
    });
    expect(body.id).toBeDefined();

    const dbRow = await harness
      .getDataSource()
      .getRepository(RefundRecordOrmEntity)
      .findOne({ where: { internalOrderId: order.internalOrderId } });
    expect(dbRow).toBeDefined();
    expect(dbRow?.amount).toBe('49.99');
    expect(dbRow?.currency).toBe('PLN');
  });

  it('should list previously recorded refunds for an order', async () => {
    const order = await createTestOrderRecord(harness.getDataSource());
    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());

    await http
      .post(`/v1/orders/${order.internalOrderId}/refunds`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: '10.00', currency: 'PLN', reason: 'defective' })
      .expect(201);

    const response = await http
      .get(`/v1/orders/${order.internalOrderId}/refunds`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const body = response.body as RefundRecordResponseBody[];

    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ amount: '10.00', reason: 'defective' });
  });

  it('should return an empty array for an order with no refunds', async () => {
    const order = await createTestOrderRecord(harness.getDataSource());
    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());

    const response = await http
      .get(`/v1/orders/${order.internalOrderId}/refunds`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toEqual([]);
  });

  it('should return 404 when recording a refund against a nonexistent order', async () => {
    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());

    await http
      .post('/v1/orders/ol_order_does_not_exist/refunds')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: '10.00', currency: 'PLN', reason: 'other' })
      .expect(404);
  });
});
