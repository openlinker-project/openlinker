/**
 * PrestaShop Order Fulfillment Update Int-Spec (#858 — capability B)
 *
 * Verifies `PrestashopOrderProcessorManagerAdapter.updateFulfillment` against a
 * real PrestaShop Testcontainer: the state transition must go through the
 * PS-intended `POST /order_histories` primitive (so `current_state` advances)
 * and tracking must land on the `order_carriers` association.
 *
 * Module-free by design (`installOlModule: false`): `updateFulfillment` does
 * not touch the OL Dynamic carrier sidecar, so this spec avoids the CI-flaky
 * module-install path (#716) and runs on CI like `prestashop-harness-smoke`.
 * An order is still needed to transition; it is created module-free via the
 * `OrderIngestionService` ingest path with a `defaultCarrierId` on the PS
 * connection (carrier-resolution chain step 2 — no sidecar write), mirroring
 * S-2 of `allegro-prestashop-carrier-mapping.int-spec.ts`.
 *
 * Asserts: a new `order_histories` row at the shipped state id, `current_state`
 * advanced to 4, `order_carriers.tracking_number` set, and idempotency (a
 * second call adds no further history row and leaves tracking unchanged).
 *
 * NOT asserted — accepted gap (#858 Q6): actual buyer-email *delivery*. That's
 * PrestaShop's own contract behind `sendmail=1` (which OL's unit spec proves we
 * request); verifying delivery needs an SMTP catcher, disproportionate here.
 * The `current_state` advance below is also the design's proof that a WS
 * `order_histories` POST actually transitions state on PS 9.0.2 — and that the
 * `sendmail=1` flag does NOT 500 the POST when the container has no SMTP
 * transport (PS attempts the mail, fails silently, and the state still lands).
 *
 * @module apps/api/test/integration/prestashop
 */
import { randomUUID } from 'crypto';
import {
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  IIdentifierMappingService,
} from '@openlinker/core/identifier-mapping';
import { INTEGRATIONS_SERVICE_TOKEN, IIntegrationsService } from '@openlinker/core/integrations';
import {
  ORDER_INGESTION_SERVICE_TOKEN,
  IOrderIngestionService,
  OrderProcessorManagerPort,
  isOrderFulfillmentUpdater,
} from '@openlinker/core/orders';
import { ProductOrmEntity, ProductVariantOrmEntity } from '@openlinker/core/products/orm-entities';
import { getTestHarness, IntegrationTestHarness } from '../setup';
import {
  PrestashopTestContainer,
  startPrestashopContainer,
} from '../helpers/prestashop-container.helper';
import {
  DefaultPrestashopCarriers,
  getDefaultPsCarriers,
  seedPrestashopProductForOrders,
} from '../helpers/prestashop-fixture.helper';
import {
  AllegroTestSourceStub,
  installAllegroTestSourceStub,
} from '../helpers/allegro-test-source-stub.helper';
import {
  createTestAllegroSourceConnection,
  createTestPrestashopDestinationConnection,
} from '../helpers/test-connection.helper';
import { createIncomingOrderForCarrierMapping } from '../fixtures/incoming-order.fixtures';

const SHIPPED_STATE_ID = 4;
const TRACKING_NUMBER = 'TRACK-INT-858';

interface PsOrderRow {
  id: string | number;
  current_state: string | number;
}
interface PsOrderHistoryRow {
  id: string | number;
  id_order: string | number;
  id_order_state: string | number;
}
interface PsOrderCarrierRow {
  id: string | number;
  id_order: string | number;
  tracking_number?: string;
}

function basicAuthHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`;
}

/** GET a single PS resource and unwrap its singular envelope. */
async function fetchPsOrder(ps: PrestashopTestContainer, idOrder: number): Promise<PsOrderRow> {
  const response = await fetch(`${ps.baseUrl}/api/orders/${idOrder}?output_format=JSON`, {
    headers: { Authorization: basicAuthHeader(ps.webserviceApiKey) },
  });
  if (!response.ok) {
    throw new Error(`PS WS GET /api/orders/${idOrder} failed: ${response.status}`);
  }
  const json = (await response.json()) as { order?: PsOrderRow };
  if (!json.order) {
    throw new Error(`PS WS GET /api/orders/${idOrder} returned no 'order' envelope`);
  }
  return json.order;
}

/** GET a list resource filtered by `id_order`, normalised to an array. */
async function fetchPsListByOrder<T>(
  ps: PrestashopTestContainer,
  resource: 'order_histories' | 'order_carriers',
  idOrder: number
): Promise<T[]> {
  const url =
    `${ps.baseUrl}/api/${resource}?output_format=JSON&display=full&filter[id_order]=${idOrder}`;
  const response = await fetch(url, {
    headers: { Authorization: basicAuthHeader(ps.webserviceApiKey) },
  });
  if (!response.ok) {
    throw new Error(`PS WS GET /api/${resource} (id_order=${idOrder}) failed: ${response.status}`);
  }
  const json = (await response.json()) as Record<string, unknown>;
  const data = json[resource];
  if (Array.isArray(data)) return data as T[];
  return data ? [data as T] : [];
}

/** Parse the destination-native PS order id from an `OrderRef` (#909). */
function destinationOrderIdFromRef(orderRef: { orderId: string }): number {
  const parsed = Number(orderRef.orderId);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`PS-side order id not a positive integer: '${orderRef.orderId}'`);
  }
  return parsed;
}

/**
 * Seed one orderable PS product + the OL Product/ProductVariant rows + the two
 * identifier_mappings (source Offer mapping + destination Product mapping) the
 * ingest path needs. Mirrors `seedScenario` in the carrier-mapping spec.
 */
async function seedOrderableProduct(opts: {
  harness: IntegrationTestHarness;
  psMysqlAddress: Parameters<typeof seedPrestashopProductForOrders>[0];
  externalOfferId: string;
  psReference: string;
  psName: string;
  allegroConnectionId: string;
  prestashopConnectionId: string;
}): Promise<void> {
  const psProduct = await seedPrestashopProductForOrders(opts.psMysqlAddress, {
    reference: opts.psReference,
    name: opts.psName,
  });

  const dataSource = opts.harness.getDataSource();
  const identifierMapping = opts.harness
    .getApp()
    .get<IIdentifierMappingService>(IDENTIFIER_MAPPING_SERVICE_TOKEN);

  const internalProductId = await identifierMapping.getOrCreateInternalId(
    'Product',
    String(psProduct.idProduct),
    opts.prestashopConnectionId
  );
  const internalVariantId = `ol_variant_${randomUUID().replace(/-/g, '')}`;

  await identifierMapping.createMapping(
    'Offer',
    opts.externalOfferId,
    opts.allegroConnectionId,
    internalVariantId
  );

  const productRepo = dataSource.getRepository(ProductOrmEntity);
  await productRepo.save(
    productRepo.create({
      id: internalProductId,
      name: opts.psName,
      sku: opts.psReference,
      price: 100.0,
      currency: 'PLN',
    })
  );
  const variantRepo = dataSource.getRepository(ProductVariantOrmEntity);
  await variantRepo.save(
    variantRepo.create({
      id: internalVariantId,
      productId: internalProductId,
      sku: opts.psReference,
    })
  );
}

describe('PrestaShop order fulfillment update (#858)', () => {
  let harness: IntegrationTestHarness;
  let ps: PrestashopTestContainer;
  let stub: AllegroTestSourceStub;
  let allegroConnectionId: string;
  let prestashopConnectionId: string;
  let defaultCarriers: DefaultPrestashopCarriers;
  let psOrderId: number;

  beforeAll(async () => {
    harness = await getTestHarness();
    // Module-free: updateFulfillment never touches the OL sidecar, so we skip
    // the CI-flaky module install. The OL Dynamic carrier stub row is still
    // seeded by applyPrestashopFixture, so discoverDynamicCarrierId() passes.
    ps = await startPrestashopContainer({ installOlModule: false });
    defaultCarriers = await getDefaultPsCarriers(ps.mysqlAddress);

    stub = installAllegroTestSourceStub(harness);
    const allegro = await createTestAllegroSourceConnection(harness.getDataSource(), {
      adapterKey: stub.adapterKey,
      platformType: stub.platformType,
    });
    allegroConnectionId = allegro.id;

    const prestashop = await createTestPrestashopDestinationConnection(harness.getDataSource(), {
      baseUrl: ps.baseUrl,
      webserviceApiKey: ps.webserviceApiKey,
      // defaultCarrierId → carrier-resolution chain step 2, no OL sidecar write.
      defaultCarrierId: defaultCarriers.myCheapCarrier.idCarrier,
    });
    prestashopConnectionId = prestashop.id;

    await seedOrderableProduct({
      harness,
      psMysqlAddress: ps.mysqlAddress,
      externalOfferId: 'ALG-OFFER-858',
      psReference: 'SEEDED-SKU-858',
      psName: 'Fulfillment-update product',
      allegroConnectionId,
      prestashopConnectionId,
    });

    // Create the order to transition (module-free ingest path).
    stub.setNextIncomingOrder(
      createIncomingOrderForCarrierMapping({
        externalOrderId: 'ALG-858',
        methodId: 'paczkomat-858',
        externalOfferId: 'ALG-OFFER-858',
        sku: 'SEEDED-SKU-858',
      })
    );
    const ingestion = harness.getApp().get<IOrderIngestionService>(ORDER_INGESTION_SERVICE_TOKEN);
    const results = await ingestion.syncOrderFromSource(allegroConnectionId, 'ALG-858');
    if (results[0]?.status !== 'success') {
      throw new Error(
        `Order seed failed: ${results[0] ? results[0].error.message : 'no result'}`
      );
    }
    // orderRef.orderId is the destination-native PrestaShop order id (#909).
    psOrderId = destinationOrderIdFromRef(results[0].orderRef);
  }, 15 * 60_000);

  afterAll(async () => {
    if (ps) {
      await ps.cleanup();
    }
  });

  it('should transition state via order_histories + write tracking, idempotently', async () => {
    const integrations = harness
      .getApp()
      .get<IIntegrationsService>(INTEGRATIONS_SERVICE_TOKEN);
    const adapter = await integrations.getCapabilityAdapter<OrderProcessorManagerPort>(
      prestashopConnectionId,
      'OrderProcessorManager'
    );
    if (!isOrderFulfillmentUpdater(adapter)) {
      throw new Error('PrestaShop adapter does not implement OrderFulfillmentUpdater');
    }

    // Sanity: the seeded order is not already shipped.
    const before = await fetchPsOrder(ps, psOrderId);
    expect(Number(before.current_state)).not.toBe(SHIPPED_STATE_ID);

    // First update — transition + tracking.
    await adapter.updateFulfillment({
      externalOrderId: String(psOrderId),
      status: 'shipped',
      trackingNumber: TRACKING_NUMBER,
    });

    const after = await fetchPsOrder(ps, psOrderId);
    expect(Number(after.current_state)).toBe(SHIPPED_STATE_ID);

    const historiesAfterFirst = await fetchPsListByOrder<PsOrderHistoryRow>(
      ps,
      'order_histories',
      psOrderId
    );
    const shippedHistories = historiesAfterFirst.filter(
      (h) => Number(h.id_order_state) === SHIPPED_STATE_ID
    );
    expect(shippedHistories.length).toBe(1); // proves the transition went via order_histories

    const carriers = await fetchPsListByOrder<PsOrderCarrierRow>(ps, 'order_carriers', psOrderId);
    expect(carriers.length).toBeGreaterThan(0);
    expect(carriers[0].tracking_number).toBe(TRACKING_NUMBER);

    // Second update — idempotent: no new shipped history row, tracking unchanged.
    await adapter.updateFulfillment({
      externalOrderId: String(psOrderId),
      status: 'shipped',
      trackingNumber: TRACKING_NUMBER,
    });

    const historiesAfterSecond = await fetchPsListByOrder<PsOrderHistoryRow>(
      ps,
      'order_histories',
      psOrderId
    );
    expect(
      historiesAfterSecond.filter((h) => Number(h.id_order_state) === SHIPPED_STATE_ID).length
    ).toBe(1);
    const carriersAfter = await fetchPsListByOrder<PsOrderCarrierRow>(
      ps,
      'order_carriers',
      psOrderId
    );
    expect(carriersAfter[0].tracking_number).toBe(TRACKING_NUMBER);
  });
});
