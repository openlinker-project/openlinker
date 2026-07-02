/**
 * Shipment Label Download API Integration Test (#884)
 *
 * Exercises `GET /shipments/:id/label` end-to-end against real Postgres + Nest
 * wiring. A shipment is seeded through the generate-label endpoint (the #835
 * dispatch seam → in-memory stub adapter that also implements
 * `LabelDocumentReader`), then its label is fetched. Asserts the byte payload
 * + `Content-Type` + `Content-Disposition` round-trip, and the 404 / 422
 * branches.
 *
 * @module apps/api/test/integration
 */
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
  STUB_LABEL_BYTES,
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

describe('Shipment Label Download API Integration', () => {
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

  // Takes the caller's token + http rather than logging in itself —
  // `loginAsAdmin` does a plain INSERT of a fixed admin user (no upsert), so a
  // second login in the same test would violate the users unique constraint.
  async function seedShipment(
    http: ReturnType<IntegrationTestHarness['getHttp']>,
    token: string,
    orderId: string,
  ): Promise<string> {
    const { sourceId } = await seedRoute();
    const created = await http
      .post('/v1/shipments/generate-label')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sourceConnectionId: sourceId,
        sourceDeliveryMethodId: METHOD,
        orderId,
        shippingMethod: 'kurier',
        recipient: RECIPIENT,
        parcel: PARCEL,
      })
      .expect(200);
    return created.body.shipment.id as string;
  }

  describe('GET /shipments/:id/label', () => {
    it('should stream the label bytes with content-type + attachment disposition', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());
      const id = await seedShipment(http, token, 'ol_order_label_1');

      const res = await http
        .get(`/v1/shipments/${id}/label`)
        .set('Authorization', `Bearer ${token}`)
        .buffer(true)
        .parse((response, cb) => {
          const chunks: Buffer[] = [];
          response.on('data', (c: Buffer) => chunks.push(c));
          response.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);

      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="ol-shipment-${id}.pdf"`,
      );
      expect(Buffer.compare(res.body as Buffer, Buffer.from(STUB_LABEL_BYTES))).toBe(0);
    });

    it('should 404 when the shipment does not exist', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());

      await http
        .get('/v1/shipments/ol_shipment_missing/label')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('should 401 without auth', async () => {
      await harness.getHttp().get('/v1/shipments/ol_shipment_x/label').expect(401);
    });
  });
});
