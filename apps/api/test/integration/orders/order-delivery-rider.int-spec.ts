/**
 * Order Delivery Rider Int-Spec (#1792)
 *
 * Vertical slice for the read-only delivery-rider projection on the orders HTTP
 * endpoints: `GET /orders` (list) and `GET /orders/:internalOrderId` (detail).
 * Exercises the real `DeliveryRiderService` against real Postgres connections +
 * the real adapter registry (InPost + DPD plugins are registered at boot):
 *   - a defaulted order whose method maps to a CONNECTED carrier → `unmapped`;
 *   - a defaulted order whose method maps to a SUPPORTED-but-unconnected carrier
 *     → `not-connected`;
 *   - a method with no carrier match → `none`;
 *   - a rule-resolved order (non-default) → `none`.
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

describe('Order delivery-rider projection (#1792)', () => {
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

  async function seedSource(): Promise<string> {
    const source = await createTestConnection(harness.getDataSource(), {
      platformType: 'allegro',
      name: 'Allegro source',
      adapterKey: 'allegro.publicapi.v1',
      enabledCapabilities: ['OrderSource'],
    });
    return source.id;
  }

  it('returns rider "unmapped" for a defaulted order whose method maps to a connected carrier', async () => {
    const sourceId = await seedSource();
    await createTestConnection(harness.getDataSource(), {
      platformType: 'inpost',
      name: 'InPost carrier',
      adapterKey: 'inpost.shipx.v1',
      enabledCapabilities: ['ShippingProviderManager'],
    });
    const order = await createTestOrderRecord(harness.getDataSource(), {
      sourceConnectionId: sourceId,
      orderSnapshot: {
        items: [],
        shipping: { methodId: 'ai-inpost-1', methodName: 'Allegro Paczkomat InPost' },
      },
    });

    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());

    const detail = await http
      .get(`/v1/orders/${order.internalOrderId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(detail.body.deliveryResolution.source).toBe('default');
    expect(detail.body.deliveryRider).toEqual({
      rider: 'unmapped',
      candidateCarrier: { platformType: 'inpost', displayName: 'InPost' },
    });
    // Typed source-method projection (#1791/#1792) for the #1794 deep link.
    expect(detail.body.sourceDeliveryMethodId).toBe('ai-inpost-1');
    expect(detail.body.sourceDeliveryMethodName).toBe('Allegro Paczkomat InPost');

    const list = await http
      .get(`/v1/orders?sourceConnectionId=${sourceId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list.body.items[0].deliveryRider).toEqual({
      rider: 'unmapped',
      candidateCarrier: { platformType: 'inpost', displayName: 'InPost' },
    });
  });

  it('returns rider "not-connected" when the carrier is supported (registered) but not connected', async () => {
    const sourceId = await seedSource();
    // No DPD connection — but the DPD plugin is registered, so DPD is supported.
    const order = await createTestOrderRecord(harness.getDataSource(), {
      sourceConnectionId: sourceId,
      orderSnapshot: { items: [], shipping: { methodId: 'dpd-1', methodName: 'Kurier DPD' } },
    });

    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());

    const detail = await http
      .get(`/v1/orders/${order.internalOrderId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(detail.body.deliveryRider).toEqual({
      rider: 'not-connected',
      candidateCarrier: { platformType: 'dpd', displayName: 'DPD' },
    });
  });

  it('returns rider "none" for a method that maps to no carrier', async () => {
    const sourceId = await seedSource();
    const order = await createTestOrderRecord(harness.getDataSource(), {
      sourceConnectionId: sourceId,
      orderSnapshot: { items: [], shipping: { methodId: 'c-1', methodName: 'Kurier standardowy' } },
    });

    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());

    const detail = await http
      .get(`/v1/orders/${order.internalOrderId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(detail.body.deliveryRider).toEqual({ rider: 'none' });
    expect(detail.body.deliveryRider.candidateCarrier).toBeUndefined();
  });

  it('returns rider "none" for a rule-resolved (non-default) order even when the method maps to a carrier', async () => {
    const sourceId = await seedSource();
    const inpost = await createTestConnection(harness.getDataSource(), {
      platformType: 'inpost',
      name: 'InPost carrier',
      adapterKey: 'inpost.shipx.v1',
      enabledCapabilities: ['ShippingProviderManager'],
    });
    const routing = harness
      .getApp()
      .get<IFulfillmentRoutingService>(FULFILLMENT_ROUTING_SERVICE_TOKEN);
    await routing.replaceRules(sourceId, [
      {
        sourceDeliveryMethodId: 'ai-inpost-1',
        processorKind: FULFILLMENT_PROCESSOR_KIND.OlManagedCarrier,
        processorConnectionId: inpost.id,
      },
    ]);
    const order = await createTestOrderRecord(harness.getDataSource(), {
      sourceConnectionId: sourceId,
      orderSnapshot: {
        items: [],
        shipping: { methodId: 'ai-inpost-1', methodName: 'Allegro Paczkomat InPost' },
      },
    });

    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());

    const detail = await http
      .get(`/v1/orders/${order.internalOrderId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    // Resolution matched a rule → rider must not fire.
    expect(detail.body.deliveryResolution.source).toBe('rule');
    expect(detail.body.deliveryRider).toEqual({ rider: 'none' });
  });
});
