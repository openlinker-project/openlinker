/**
 * Order column presets — route registration order integration test (#3507 G03-10)
 *
 * `OrdersController` (`@Controller('orders')`) owns `@Get(':internalOrderId')`,
 * which matches ANY two-segment path under `/orders`. Registered before
 * `OrderColumnPresetsController` it answered `GET /orders/column-presets`
 * with `404 Order not found: column-presets`, while every three-segment
 * preset route kept working — so saving a preset succeeded and listing it
 * failed. Only a real HTTP stack exercises Nest's registration order; a
 * controller unit spec calls the handler directly and cannot see it.
 *
 * The guard at the end proves the fix did not invert the defect: a real
 * order id still reaches `OrdersController`'s detail route.
 *
 * `loginAsAdmin` is called once per test, from `beforeEach` — see
 * `order-holds-api.int-spec.ts` for why neither once-per-file nor
 * twice-per-test works.
 *
 * @module apps/api/test/integration/orders
 */
import {
  ORDER_RECORD_SERVICE_TOKEN,
  type IOrderRecordService,
  type Order,
} from '@openlinker/core/orders';
import {
  getTestHarness,
  resetTestHarness,
  teardownTestHarness,
  type IntegrationTestHarness,
} from '../setup';
import { createTestConnection } from '../helpers/test-connection.helper';
import { loginAsAdmin } from '../helpers/test-auth.helper';

const ORDER_ID = 'ol_order_presets_routing';

function makeOrder(id: string, orderNumber: string): Order {
  return {
    id,
    orderNumber,
    status: 'pending',
    items: [
      {
        id: 'l1',
        productId: 'ol_product_1',
        variantId: 'ol_variant_1',
        quantity: 1,
        price: 10,
        sku: 'SKU-1',
      },
    ],
    totals: { subtotal: 10, tax: 0, shipping: 0, total: 10, currency: 'PLN' },
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
  } as Order;
}

describe('Order column presets routing (#3507 G03-10)', () => {
  let harness: IntegrationTestHarness;
  let token: string;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  beforeEach(async () => {
    token = await loginAsAdmin(harness.getHttp(), harness.getDataSource());
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  const auth = (): { Authorization: string } => ({ Authorization: `Bearer ${token}` });

  it('should list an empty preset array when the caller has saved none', async () => {
    const response = await harness
      .getHttp()
      .get('/v1/orders/column-presets')
      .set(auth())
      .expect(200);

    expect(response.body).toEqual([]);
  });

  it('should list the preset the caller just saved when listing after a POST', async () => {
    await harness
      .getHttp()
      .post('/v1/orders/column-presets')
      .set(auth())
      .send({ name: 'Packing view', columns: ['orderNumber', 'placedAt'] })
      .expect(201);

    const response = await harness
      .getHttp()
      .get('/v1/orders/column-presets')
      .set(auth())
      .expect(200);

    const presets = response.body as Array<{ name: string; columns: string[] }>;
    expect(presets).toHaveLength(1);
    expect(presets[0]).toMatchObject({
      name: 'Packing view',
      columns: ['orderNumber', 'placedAt'],
    });
  });

  it('should still serve the order detail route when the path segment is a real order id', async () => {
    const records = harness
      .getApp()
      .get<IOrderRecordService>(ORDER_RECORD_SERVICE_TOKEN, { strict: false });
    const source = await createTestConnection(harness.getDataSource(), {
      platformType: 'allegro',
      name: 'Allegro source',
      adapterKey: 'allegro.test.unused',
    });
    await records.persistOrder(makeOrder(ORDER_ID, 'ORD-PRESETS-1'), source.id, 'evt-1');

    const response = await harness
      .getHttp()
      .get(`/v1/orders/${ORDER_ID}`)
      .set(auth())
      .expect(200);

    expect((response.body as { internalOrderId: string }).internalOrderId).toBe(ORDER_ID);
  });
});
