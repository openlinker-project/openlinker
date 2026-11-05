/**
 * A 0,00 gift line on a WooCommerce destination order (#3939)
 *
 * With the OMS off, a gift that exists only in OpenLinker reaches the shop as an
 * ordinary line priced 0,00. Records whether WooCommerce accepts it and keeps it
 * as its own line. Derived from `woocommerce-order-ingest.int-spec.ts`.
 *
 * @module apps/api/test/integration/woocommerce
 */
import { getTestHarness, resetTestHarness, type IntegrationTestHarness } from '../setup';
import {
  startWooCommerceContainer,
  type WooCommerceTestContainer,
} from '../helpers/woocommerce-container.helper';
import { createTestWooCommerceConnection } from '../helpers/woocommerce-connection.helper';
import { drainProductSyncJobs } from '../helpers/woocommerce-sync.helper';
import {
  installAllegroTestSourceStub,
  type AllegroTestSourceStub,
} from '../helpers/allegro-test-source-stub.helper';
import {
  ORDER_INGESTION_SERVICE_TOKEN,
  type IOrderIngestionService,
  type IncomingOrder,
} from '@openlinker/core/orders';
import {
  ConnectionOrmEntity,
  IdentifierMappingOrmEntity,
} from '@openlinker/core/identifier-mapping/orm-entities';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';

// Skip automatically on CI (GitHub Actions sets CI=true) or when
// OL_SKIP_WC_INTEGRATION=true. These boot a real WordPress + auto-install
// WooCommerce per spec (~12 min cold), which exceeds the PR integration step's
// timeout - run them locally (with Docker) or in a dedicated longer-timeout job.
const SKIP_WC_INTEGRATION =
  process.env.CI === 'true' || process.env.OL_SKIP_WC_INTEGRATION === 'true';

(SKIP_WC_INTEGRATION ? describe.skip : describe)('WooCommerce order ingest (#878)', () => {
  let harness: IntegrationTestHarness;
  let wc: WooCommerceTestContainer;
  let wcConnectionId: string;
  let allegroConnectionId: string;
  let stub: AllegroTestSourceStub;
  let ingestService: IOrderIngestionService;

  beforeAll(async () => {
    harness = await getTestHarness();
    wc = await startWooCommerceContainer();

    // Register stub Allegro OrderSource
    stub = installAllegroTestSourceStub(harness);

    // Create Allegro source connection pointing at the stub adapter key
    const allegroRepo = harness.getDataSource().getRepository(ConnectionOrmEntity);
    const allegroConn = await allegroRepo.save(
      allegroRepo.create({
        platformType: stub.platformType,
        name: 'Test Allegro source',
        status: 'active',
        config: {},
        credentialsRef: 'env:ALLEGRO_CLIENT_ID',
        adapterKey: stub.adapterKey,
        enabledCapabilities: ['OrderSource'],
      }),
    );
    allegroConnectionId = allegroConn.id;

    // Create WC connection as destination
    const wcConn = await createTestWooCommerceConnection(harness.getDataSource(), {
      siteUrl: wc.baseUrl,
      consumerKey: wc.consumerKey,
      consumerSecret: wc.consumerSecret,
      enabledCapabilities: ['ProductMaster', 'OrderProcessorManager'],
    });
    wcConnectionId = wcConn.id;

    // Populate identifier mappings via adapter path (REQUIRED before createOrder).
    // WooCommerceOrderProcessorAdapter.resolveLineItems() calls
    // identifierMapping.getExternalIds(Product, productId) - throws if missing.
    await drainProductSyncJobs(harness, wcConnectionId, [wc.simpleProductExternalId]);

    // The order-ingestion item resolver calls getInternalId(Product, externalId, connectionId)
    // with connectionId = allegroConnectionId (the source connection). drainProductSyncJobs
    // created the mapping under wcConnectionId. Create an alias mapping so the resolver
    // can find the product when called with the Allegro source connection.
    const mappingRepo = harness.getDataSource().getRepository(IdentifierMappingOrmEntity);
    const wcProductMapping = await mappingRepo.findOneOrFail({
      where: {
        entityType: CORE_ENTITY_TYPE.Product,
        externalId: wc.simpleProductExternalId,
        connectionId: wcConnectionId,
      },
    });
    await mappingRepo.save(
      mappingRepo.create({
        entityType: CORE_ENTITY_TYPE.Product,
        externalId: wc.simpleProductExternalId,
        internalId: wcProductMapping.internalId,
        platformType: stub.platformType,
        connectionId: allegroConnectionId,
        context: null,
      }),
    );

    // Configure stub Allegro source to yield a test order with 2× WC-SHIRT-001.
    // The IncomingOrder shape requires the full domain DTO - productRef uses
    // type: 'product' since WC sources products, not offers.
    const testOrder: IncomingOrder = {
      externalOrderId: 'allegro-wc-test-order-1',
      status: 'processing',
      customerEmail: 'buyer@test.example',
      items: [
        {
          id: 'item-1',
          productRef: { type: 'product', externalId: wc.simpleProductExternalId },
          quantity: 2,
          price: 49.99,
          name: 'OL Test Shirt',
        },
        {
          id: 'item-gift',
          productRef: { type: 'product', externalId: wc.simpleProductExternalId },
          quantity: 1,
          price: 0,
          name: 'OL Test Shirt (gift)',
          gift: { source: 'ol-rule' },
        },
      ],
      totals: { subtotal: 99.98, tax: 0, shipping: 0, total: 99.98, currency: 'PLN', taxTreatment: 'exclusive' },
      shippingAddress: {
        firstName: 'Jan',
        lastName: 'Kowalski',
        address1: 'ul. Testowa 1',
        city: 'Warszawa',
        postalCode: '00-001',
        country: 'PL',
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: { internalOrderId: 'ol-test-order-wc-ingest-1' },
    };
    stub.setNextIncomingOrder(testOrder);

    // Get ingest service directly - bypasses OL_WOOCOMMERCE_POLL_SCHEDULER_ENABLED cron gate.
    // syncOrderFromSource(connectionId: string, externalOrderId: string):
    //   connectionId = SOURCE (Allegro); WC destination auto-resolved from active
    //   OrderProcessorManager connections.
    ingestService = harness
      .getApp()
      .get<IOrderIngestionService>(ORDER_INGESTION_SERVICE_TOKEN);
  }, 15 * 60_000);

  afterEach(async () => {
    // Truncate OL DB tables between tests so state from one test does not
    // pollute the next (per testing guide §Integration Tests best practices).
    await resetTestHarness();
  });

  afterAll(async () => {
    await wc.cleanup();
  });

  it('should accept a 0,00 line on the WooCommerce order and keep it as its own line', async () => {
    const results = await ingestService.syncOrderFromSource(
      allegroConnectionId,
      'allegro-wc-test-order-1',
    );
    expect(results[0]).toMatchObject({ status: 'success' });

    const auth = Buffer.from(`${wc.consumerKey}:${wc.consumerSecret}`).toString('base64');
    const res = await fetch(`${wc.baseUrl}/wp-json/wc/v3/orders`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    const orders = (await res.json()) as Array<{
      line_items: Array<{ quantity: number; total: string; subtotal: string }>;
    }>;
    // eslint-disable-next-line no-console -- recorded probe output, not logging
    console.warn(`GIFT0_WC_EVIDENCE ${JSON.stringify(orders[0]?.line_items)}`);
    expect(orders).toHaveLength(1);
    expect(orders[0].line_items).toHaveLength(2);
    expect(orders[0].line_items.map((line) => Number(line.total)).sort((x, y) => x - y)).toEqual([
      0, 99.98,
    ]);
  });
});
