/**
 * Order Delivery Resolution Int-Spec (#1791)
 *
 * Vertical slice for the read-only delivery-routing-resolution projection on
 * the orders HTTP endpoints: `GET /orders` (list, batched) and
 * `GET /orders/:internalOrderId` (detail). Exercises the real
 * `FulfillmentRoutingService.resolve` / `resolveBatch` against real Postgres
 * (a persisted routing rule vs. the omp_fulfilled default vs. no delivery
 * method at all) — the layers the controller unit spec mocks.
 *
 * @module apps/api/test/integration/orders
 */
import {
  FULFILLMENT_PROCESSOR_KIND,
  FULFILLMENT_ROUTING_SERVICE_TOKEN,
  IFulfillmentRoutingService,
} from '@openlinker/core/mappings';
import { getTestHarness, IntegrationTestHarness, resetTestHarness, teardownTestHarness } from '../setup';
import { loginAsAdmin } from '../helpers/test-auth.helper';
import { createTestConnection } from '../helpers/test-connection.helper';
import { createTestOrderRecord } from '../fixtures/order.fixtures';

describe('Order delivery-resolution projection (#1791)', () => {
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

  async function seedConnections(): Promise<{ sourceId: string; inpostId: string }> {
    const dataSource = harness.getDataSource();
    const source = await createTestConnection(dataSource, {
      platformType: 'allegro',
      name: 'Allegro source',
      adapterKey: 'allegro.publicapi.v1',
      enabledCapabilities: ['OrderSource'],
    });
    const inpost = await createTestConnection(dataSource, {
      platformType: 'inpost',
      name: 'InPost carrier',
      adapterKey: 'inpost.shipx.v1',
      enabledCapabilities: ['ShippingProviderManager'],
    });
    return { sourceId: source.id, inpostId: inpost.id };
  }

  it('should surface the rule-matched resolution on both the detail and list reads', async () => {
    const { sourceId, inpostId } = await seedConnections();
    const routing = harness.getApp().get<IFulfillmentRoutingService>(FULFILLMENT_ROUTING_SERVICE_TOKEN);
    await routing.replaceRules(sourceId, [
      {
        sourceDeliveryMethodId: 'courier-standard',
        processorKind: FULFILLMENT_PROCESSOR_KIND.OlManagedCarrier,
        processorConnectionId: inpostId,
      },
    ]);
    const order = await createTestOrderRecord(harness.getDataSource(), {
      sourceConnectionId: sourceId,
      orderSnapshot: { items: [], shipping: { methodId: 'courier-standard' } },
    });

    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());

    const detail = await http
      .get(`/v1/orders/${order.internalOrderId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(detail.body.deliveryResolution).toEqual({
      source: 'rule',
      processorKind: 'ol_managed_carrier',
      processorConnectionId: inpostId,
    });

    const list = await http
      .get(`/v1/orders?sourceConnectionId=${sourceId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].deliveryResolution).toEqual({
      source: 'rule',
      processorKind: 'ol_managed_carrier',
      processorConnectionId: inpostId,
    });
  });

  it('should fall back to the omp_fulfilled default when the delivery method has no configured rule', async () => {
    const { sourceId } = await seedConnections();
    const order = await createTestOrderRecord(harness.getDataSource(), {
      sourceConnectionId: sourceId,
      orderSnapshot: { items: [], shipping: { methodId: 'unmapped-method' } },
    });

    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());

    const detail = await http
      .get(`/v1/orders/${order.internalOrderId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(detail.body.deliveryResolution).toEqual({
      source: 'default',
      processorKind: 'omp_fulfilled',
      processorConnectionId: null,
    });

    const list = await http
      .get(`/v1/orders?sourceConnectionId=${sourceId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list.body.items[0].deliveryResolution).toEqual({
      source: 'default',
      processorKind: 'omp_fulfilled',
      processorConnectionId: null,
    });
  });

  it('should omit deliveryResolution when the order carries no source delivery method', async () => {
    const order = await createTestOrderRecord(harness.getDataSource(), {
      orderSnapshot: { items: [] },
    });

    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());

    const detail = await http
      .get(`/v1/orders/${order.internalOrderId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(detail.body.deliveryResolution).toBeUndefined();

    const list = await http
      .get(`/v1/orders?sourceConnectionId=${order.sourceConnectionId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list.body.items[0].deliveryResolution).toBeUndefined();
  });
});
