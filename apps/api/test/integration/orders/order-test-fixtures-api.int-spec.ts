/**
 * Order Test Fixtures API Integration Test (#2855)
 *
 * `POST /orders/:internalOrderId/test-fixtures/mark-pre-rollout-era` is the
 * narrow, double(+env-gated-triple)-gated seam that stamps
 * `taxRateEra = 'pre-rollout'` so a non-production install can reach the
 * `tax-a` / `tax-c` analytics coverage states with a fresh, flow-seeded order.
 *
 * What only an int-spec can prove here:
 *
 * 1. **The guarded `UPDATE ... WHERE "taxRateEra" IS DISTINCT FROM 'pre-rollout'`
 *    is really idempotent against real Postgres** — a unit-mocked repository
 *    cannot show the second call returns `applied: false` against a row the
 *    first call actually changed.
 * 2. **`NODE_ENV=production` refuses even with the env var set**, over the
 *    real HTTP -> guard pipeline (`RolesGuard`, `JwtAuthGuard`) rather than a
 *    hand-constructed service.
 * 3. **The env gate is checked BEFORE the order lookup** — a request for an
 *    order that does not exist still answers 403 (not 404) when the gate is
 *    closed, which only the real controller wiring proves.
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

const ORDER_ID = 'ol_order_test_fixtures_api';

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

describe('Order test-fixtures API (#2855)', () => {
  let harness: IntegrationTestHarness;
  let token: string;
  const previousAllowTestFixtures = process.env.OL_ALLOW_TEST_FIXTURES;
  const previousNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  beforeEach(async () => {
    // Once per TEST — mirrors order-holds-api.int-spec.ts's rationale: a
    // second `loginAsAdmin` call inside one test violates the users unique
    // constraint, and `resetTestHarness` truncates `users` between tests.
    token = await loginAsAdmin(harness.getHttp(), harness.getDataSource());

    const records = harness
      .getApp()
      .get<IOrderRecordService>(ORDER_RECORD_SERVICE_TOKEN, { strict: false });

    const source = await createTestConnection(harness.getDataSource(), {
      platformType: 'allegro',
      name: 'Allegro source',
      adapterKey: 'allegro.test.unused',
    });

    await records.persistOrder(makeOrder(ORDER_ID, 'ORD-TEST-FIXTURES-1'), source.id, 'evt-1');
  });

  afterEach(async () => {
    if (previousAllowTestFixtures === undefined) {
      delete process.env.OL_ALLOW_TEST_FIXTURES;
    } else {
      process.env.OL_ALLOW_TEST_FIXTURES = previousAllowTestFixtures;
    }
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  const markPreRolloutEra = (orderId: string) =>
    harness
      .getHttp()
      .post(`/v1/orders/${orderId}/test-fixtures/mark-pre-rollout-era`)
      .set(auth())
      .send({});

  it('should answer 403 TEST_FIXTURES_DISABLED when the env var is unset', async () => {
    delete process.env.OL_ALLOW_TEST_FIXTURES;

    const res = await markPreRolloutEra(ORDER_ID).expect(403);

    expect(res.body.error).toBe('TEST_FIXTURES_DISABLED');
  });

  it('should answer 403 BEFORE looking up the order when the gate is closed', async () => {
    delete process.env.OL_ALLOW_TEST_FIXTURES;

    // An order id that does not exist — a 404 here would mean the lookup ran
    // ahead of the (cheaper, side-effect-free) gate check.
    const res = await markPreRolloutEra('ol_order_does_not_exist').expect(403);

    expect(res.body.error).toBe('TEST_FIXTURES_DISABLED');
  });

  it('should stamp the order idempotently when the env var is true', async () => {
    process.env.OL_ALLOW_TEST_FIXTURES = 'true';

    const first = await markPreRolloutEra(ORDER_ID).expect(200);
    expect(first.body.applied).toBe(true);

    const second = await markPreRolloutEra(ORDER_ID).expect(200);
    expect(second.body.applied).toBe(false);
  });

  it('should answer 403 under NODE_ENV=production even with the env var set', async () => {
    process.env.OL_ALLOW_TEST_FIXTURES = 'true';
    process.env.NODE_ENV = 'production';

    const res = await markPreRolloutEra(ORDER_ID).expect(403);

    expect(res.body.error).toBe('TEST_FIXTURES_DISABLED');
  });

  it('should answer 404 for an order that does not exist when the gate is open', async () => {
    process.env.OL_ALLOW_TEST_FIXTURES = 'true';

    await markPreRolloutEra('ol_order_does_not_exist').expect(404);
  });
});
