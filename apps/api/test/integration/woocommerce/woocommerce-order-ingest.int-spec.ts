/**
 * WooCommerce Order Ingest Int-Spec (#878)
 *
 * Exercises the Allegro → WooCommerce order ingestion path against a real
 * WooCommerce Testcontainer:
 *
 *   S-1 — Allegro order appears in WC:
 *     Stub Allegro OrderSource yields 1 order with 2× WC-SHIRT-001.
 *     IOrderIngestionService.syncOrderFromSource() is called directly
 *     (bypasses OL_WOOCOMMERCE_POLL_SCHEDULER_ENABLED cron gate).
 *     Assert WC has exactly 1 order with correct product and quantity.
 *
 *   S-2 — Idempotency (same internalOrderId):
 *     syncOrderFromSource() called again with the same externalOrderId.
 *     Assert WC still has exactly 1 order (second call returns early via
 *     identifier mapping hit on the Order entity).
 *
 * Suite-scoped: WC container boots in beforeAll.
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
// timeout — run them locally (with Docker) or in a dedicated longer-timeout job.
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
    // identifierMapping.getExternalIds(Product, productId) — throws if missing.
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
    // The IncomingOrder shape requires the full domain DTO — productRef uses
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
      ],
      totals: { subtotal: 99.98, tax: 0, shipping: 0, total: 99.98, currency: 'PLN' },
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

    // Get ingest service directly — bypasses OL_WOOCOMMERCE_POLL_SCHEDULER_ENABLED cron gate.
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

  it(
    'S-1 + S-2: should create WC order from Allegro order and be idempotent on re-ingest',
    async () => {
      // S-1: first ingest — WC order is created
      await ingestService.syncOrderFromSource(allegroConnectionId, 'allegro-wc-test-order-1');

      const auth = Buffer.from(`${wc.consumerKey}:${wc.consumerSecret}`).toString('base64');
      const resAfterFirst = await fetch(`${wc.baseUrl}/wp-json/wc/v3/orders`, {
        headers: { Authorization: `Basic ${auth}` },
      });
      expect(resAfterFirst.ok).toBe(true);

      const ordersAfterFirst = await resAfterFirst.json() as Array<{
        id: number;
        status: string;
        line_items: Array<{ product_id: number; quantity: number }>;
      }>;

      expect(ordersAfterFirst).toHaveLength(1);
      expect(ordersAfterFirst[0].status).toBe('processing');
      expect(ordersAfterFirst[0].line_items[0].product_id).toBe(
        Number(wc.simpleProductExternalId),
      );
      expect(ordersAfterFirst[0].line_items[0].quantity).toBe(2);

      // S-2: second ingest with the same externalOrderId — identifier mapping hit
      // returns early without calling WC, so WC still has exactly 1 order.
      // S-1 and S-2 are combined into one it() because S-2 intentionally relies
      // on the OL DB state (identifier_mappings) written by S-1.
      await ingestService.syncOrderFromSource(allegroConnectionId, 'allegro-wc-test-order-1');

      const resAfterSecond = await fetch(`${wc.baseUrl}/wp-json/wc/v3/orders`, {
        headers: { Authorization: `Basic ${auth}` },
      });
      const ordersAfterSecond = await resAfterSecond.json() as unknown[];
      expect(ordersAfterSecond).toHaveLength(1); // still exactly 1 — no duplicate
    },
  );
});
