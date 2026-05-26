/**
 * Shipments Read + Command API Integration Test (#846)
 *
 * Exercises the `/shipments` HTTP surface end-to-end against real Postgres +
 * Nest wiring. Shipments are seeded through the generate-label endpoint (the
 * #835 dispatch seam routed to the in-memory stub adapter) rather than the
 * repository, mirroring `shipment-dispatch.int-spec.ts` and keeping the test
 * off `ShipmentRepositoryPort` (banned cross-context).
 *
 * Covers: list shape + filters (status / connectionId / hasTracking — the
 * boolean-coercion regression) + pagination; by-id + active reads + 404s;
 * generate-label dispatched + omp_fulfilled; cancel happy path + idempotency.
 * The not-cancellable-state / cancellation-not-supported branches are covered
 * by the cancellation-service unit spec.
 *
 * @module apps/api/test/integration
 */
import request from 'supertest';
import {
  FULFILLMENT_PROCESSOR_KIND,
  FULFILLMENT_ROUTING_SERVICE_TOKEN,
  IFulfillmentRoutingService,
} from '@openlinker/core/mappings';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';
import { loginAsAdmin } from './helpers/test-auth.helper';
import { createTestConnection } from './helpers/test-connection.helper';
import {
  INPOST_TEST_ADAPTER_KEY,
  installInpostTestShippingStub,
} from './helpers/inpost-test-shipping-stub.helper';

const RECIPIENT = {
  email: 'buyer@example.com',
  phone: '+48500600700',
  address: {
    street: 'Krakowska',
    buildingNumber: '12',
    city: 'Poznań',
    postCode: '60-001',
    countryCode: 'PL',
  },
};
const PARCEL = { dimensions: { length: 200, width: 150, height: 100 }, weightGrams: 1200 };
const METHOD = 'allegro-courier';

describe('Shipments Read + Command API Integration', () => {
  let harness: IntegrationTestHarness;

  beforeAll(async () => {
    harness = await getTestHarness();
    installInpostTestShippingStub(harness);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  const routingService = (): IFulfillmentRoutingService =>
    harness.getApp().get<IFulfillmentRoutingService>(FULFILLMENT_ROUTING_SERVICE_TOKEN);

  async function seedRoute(): Promise<{ sourceId: string; carrierId: string }> {
    const dataSource = harness.getDataSource();
    const source = await createTestConnection(dataSource, {
      platformType: 'allegro',
      name: 'Allegro source',
      adapterKey: 'allegro.publicapi.v1',
      enabledCapabilities: ['OrderSource'],
    });
    const carrier = await createTestConnection(dataSource, {
      platformType: 'inpost',
      name: 'InPost carrier',
      adapterKey: INPOST_TEST_ADAPTER_KEY,
      enabledCapabilities: ['ShippingProviderManager'],
    });
    await routingService().replaceRules(source.id, [
      {
        sourceDeliveryMethodId: METHOD,
        processorKind: FULFILLMENT_PROCESSOR_KIND.OlManagedCarrier,
        processorConnectionId: carrier.id,
      },
    ]);
    return { sourceId: source.id, carrierId: carrier.id };
  }

  // Returns the supertest `Test` (not awaited) so callers can chain `.expect`.
  function generateLabel(
    http: ReturnType<typeof request>,
    token: string,
    sourceId: string,
    orderId: string,
    deliveryMethodId: string = METHOD,
  ): request.Test {
    return http
      .post('/shipments/generate-label')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sourceConnectionId: sourceId,
        sourceDeliveryMethodId: deliveryMethodId,
        orderId,
        shippingMethod: 'kurier',
        recipient: RECIPIENT,
        parcel: PARCEL,
      });
  }

  describe('POST /shipments/generate-label', () => {
    it('should dispatch a label-generating order to a persisted generated shipment', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());
      const { sourceId, carrierId } = await seedRoute();

      const res = await generateLabel(http, token, sourceId, 'ol_order_gl_1').expect(200);

      expect(res.body.kind).toBe('dispatched');
      expect(res.body.shipment).toMatchObject({
        orderId: 'ol_order_gl_1',
        connectionId: carrierId,
        status: 'generated',
      });
      expect(res.body.shipment.providerShipmentId).toMatch(/^stub-/);
      expect(res.body.shipment.trackingNumber).toBeNull();
    });

    it('should return omp_fulfilled with no shipment for an unmapped method', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());
      const { sourceId } = await seedRoute();

      const res = await generateLabel(http, token, sourceId, 'ol_order_omp', 'unmapped').expect(200);

      expect(res.body).toEqual({ kind: 'omp_fulfilled' });
    });

    it('should reject an invalid body with 400', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());

      await http
        .post('/shipments/generate-label')
        .set('Authorization', `Bearer ${token}`)
        .send({ sourceConnectionId: 'not-a-uuid', orderId: '', shippingMethod: 'pigeon' })
        .expect(400);
    });
  });

  describe('GET /shipments', () => {
    it('should return an empty page when no shipments exist', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());

      const res = await http.get('/shipments').set('Authorization', `Bearer ${token}`).expect(200);

      expect(res.body).toMatchObject({ items: [], total: 0, limit: 20, offset: 0 });
    });

    it('should list seeded shipments and filter by status / connectionId', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());
      const { sourceId, carrierId } = await seedRoute();
      await generateLabel(http, token, sourceId, 'ol_order_list_1').expect(200);

      const all = await http.get('/shipments').set('Authorization', `Bearer ${token}`).expect(200);
      expect(all.body.total).toBe(1);
      expect(all.body.items[0].orderId).toBe('ol_order_list_1');

      const byStatus = await http
        .get('/shipments?status=generated')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(byStatus.body.total).toBe(1);

      const byConn = await http
        .get(`/shipments?connectionId=${carrierId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(byConn.body.total).toBe(1);

      const otherConn = await http
        .get('/shipments?connectionId=00000000-0000-4000-8000-000000000000')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(otherConn.body.total).toBe(0);
    });

    it('should honour hasTracking coercion — false includes the stub shipment, true excludes it', async () => {
      // The stub returns trackingNumber: null, so the seeded shipment has no
      // tracking. This is the regression guard for the @Transform fix: a naive
      // @Type(() => Boolean) would coerce "false" → true and break this.
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());
      const { sourceId } = await seedRoute();
      await generateLabel(http, token, sourceId, 'ol_order_tracking').expect(200);

      const withoutTracking = await http
        .get('/shipments?hasTracking=false')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(withoutTracking.body.total).toBe(1);

      const withTracking = await http
        .get('/shipments?hasTracking=true')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(withTracking.body.total).toBe(0);
    });

    it('should paginate', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());
      const { sourceId } = await seedRoute();
      await generateLabel(http, token, sourceId, 'ol_order_p1').expect(200);
      await generateLabel(http, token, sourceId, 'ol_order_p2').expect(200);

      const page = await http
        .get('/shipments?limit=1&offset=0')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(page.body.total).toBe(2);
      expect(page.body.items).toHaveLength(1);
      expect(page.body.limit).toBe(1);
    });
  });

  describe('GET /shipments/:id and /active', () => {
    it('should read a shipment by id and by active-order, and 404 when absent', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());
      const { sourceId } = await seedRoute();
      const created = await generateLabel(http, token, sourceId, 'ol_order_read').expect(200);
      const id = created.body.shipment.id as string;

      const byId = await http
        .get(`/shipments/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(byId.body.id).toBe(id);

      const active = await http
        .get('/shipments/active?orderId=ol_order_read')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(active.body.id).toBe(id);

      await http
        .get('/shipments/ol_shipment_missing')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
      await http
        .get('/shipments/active?orderId=ol_order_none')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('POST /shipments/:id/cancel', () => {
    it('should cancel a generated shipment and become idempotent', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());
      const { sourceId } = await seedRoute();
      const created = await generateLabel(http, token, sourceId, 'ol_order_cancel').expect(200);
      const id = created.body.shipment.id as string;

      const cancelled = await http
        .post(`/shipments/${id}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(cancelled.body.status).toBe('cancelled');
      expect(cancelled.body.cancelledAt).not.toBeNull();

      // Now terminal: no active shipment for the order.
      await http
        .get('/shipments/active?orderId=ol_order_cancel')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      // Idempotent re-cancel.
      const again = await http
        .post(`/shipments/${id}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(again.body.status).toBe('cancelled');
    });

    it('should 404 when cancelling a missing shipment', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());

      await http
        .post('/shipments/ol_shipment_missing/cancel')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });
});
