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
import { getTestHarness, type IntegrationTestHarness } from '../setup';
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
// Static import — ConnectionOrmEntity is always needed in beforeAll setup
import { ConnectionOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';

describe('WooCommerce order ingest (#878)', () => {
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

  afterAll(async () => {
    await wc.cleanup();
  });

  it('S-1: should create WC order from Allegro order with correct line items', async () => {
    await ingestService.syncOrderFromSource(allegroConnectionId, 'allegro-wc-test-order-1');

    const auth = Buffer.from(`${wc.consumerKey}:${wc.consumerSecret}`).toString('base64');
    const res = await fetch(`${wc.baseUrl}/wp-json/wc/v3/orders`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    expect(res.ok).toBe(true);

    const orders = await res.json() as Array<{
      id: number;
      status: string;
      line_items: Array<{ product_id: number; quantity: number }>;
    }>;

    expect(orders).toHaveLength(1);
    expect(orders[0].status).toBe('processing');
    expect(orders[0].line_items[0].product_id).toBe(Number(wc.simpleProductExternalId));
    expect(orders[0].line_items[0].quantity).toBe(2);
  });

  it('S-2: should be idempotent — second call does not create a duplicate WC order', async () => {
    // Same externalOrderId — identifier mapping hit returns early without calling WC
    await ingestService.syncOrderFromSource(allegroConnectionId, 'allegro-wc-test-order-1');

    const auth = Buffer.from(`${wc.consumerKey}:${wc.consumerSecret}`).toString('base64');
    const res = await fetch(`${wc.baseUrl}/wp-json/wc/v3/orders`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    const orders = await res.json() as unknown[];
    expect(orders).toHaveLength(1); // still exactly 1
  });
});
