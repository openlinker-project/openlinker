/**
 * Catalogue-less Order Ingestion Int-Spec (#4280)
 *
 * An install that has ONLY a marketplace connection - no ProductMaster, no
 * InventoryMaster and no destination shop - must be able to ingest an order all
 * the way to `ready` and keep its lines, so the operator can track the sale and
 * ship it without ever building a catalogue.
 *
 * Runs against the real Postgres harness: the REAL identifier-mapping lookup
 * (which finds no `Offer` mapping, because no master ever wrote one), the REAL
 * `OrderRecord` upsert and the REAL `order_line_items` write - the layers a unit
 * spec mocks. Only the `OrderSource` adapter is stubbed, through the same public
 * registry seam real plugins use, so no marketplace credentials are involved.
 *
 * Allegro, Erli and Amazon are all exercised because the mechanism is marketplace
 * neutral (Amazon keys a line by its seller SKU as an offer ref, #4262): all emit `productRef: { type: 'offer', externalId }`.
 *
 * @module apps/api/test/integration/orders
 */
import {
  ADAPTER_FACTORY_RESOLVER_TOKEN,
  ADAPTER_REGISTRY_TOKEN,
  AdapterFactoryResolverService,
  AdapterRegistryPort,
} from '@openlinker/core/integrations';
import {
  IOrderIngestionService,
  ORDER_INGESTION_SERVICE_TOKEN,
  type IncomingOrder,
  type OrderSourcePort,
} from '@openlinker/core/orders';
import {
  OrderLineItemOrmEntity,
  OrderRecordOrmEntity,
} from '@openlinker/core/orders/orm-entities';
import { getTestHarness, IntegrationTestHarness, resetTestHarness, teardownTestHarness } from '../setup';
import { createTestConnection } from '../helpers/test-connection.helper';

const MARKETPLACES = [
  { platformType: 'allegro', adapterKey: 'allegro.test.catalogue-less.v1' },
  { platformType: 'erli', adapterKey: 'erli.test.catalogue-less.v1' },
  { platformType: 'amazon', adapterKey: 'amazon.test.catalogue-less.v1' },
] as const;

function makeIncoming(externalOrderId: string): IncomingOrder {
  return {
    externalOrderId,
    orderNumber: externalOrderId,
    status: 'READY_FOR_PROCESSING',
    items: [
      {
        id: 'line-1',
        productRef: { type: 'offer', externalId: '9788328345' },
        quantity: 1,
        price: 129.9,
        sku: '9788328345',
        name: 'Lampa biurkowa LED',
        taxRate: '23',
      },
      {
        id: 'line-2',
        productRef: { type: 'offer', externalId: '5901234567' },
        quantity: 2,
        price: 30,
        name: 'Zarowka E27',
      },
    ],
    totals: { subtotal: 189.9, tax: 0, shipping: 0, total: 189.9, currency: 'PLN' },
    createdAt: '2026-11-23T08:02:00.000Z',
    updatedAt: '2026-11-23T08:02:00.000Z',
  } as IncomingOrder;
}

describe('Catalogue-less order ingestion (#4280)', () => {
  let harness: IntegrationTestHarness;
  let ingestion: IOrderIngestionService;
  const sourceResponses = new Map<string, IncomingOrder>();

  beforeAll(async () => {
    harness = await getTestHarness();
    ingestion = harness.getApp().get<IOrderIngestionService>(ORDER_INGESTION_SERVICE_TOKEN);

    // Process-lifetime stubs on the public registry seam (the registry throws on a
    // duplicate adapterKey, so they are intentionally never unregistered).
    const registry = harness.getApp().get<AdapterRegistryPort>(ADAPTER_REGISTRY_TOKEN);
    const factoryResolver = harness
      .getApp()
      .get<AdapterFactoryResolverService>(ADAPTER_FACTORY_RESOLVER_TOKEN);
    const sourceStub: OrderSourcePort = {
      listOrderFeed: () => Promise.resolve({ items: [], nextCursor: null }),
      getOrder: ({ externalOrderId }) => {
        const incoming = sourceResponses.get(externalOrderId);
        return incoming
          ? Promise.resolve(incoming)
          : Promise.reject(new Error(`stub: no IncomingOrder for ${externalOrderId}`));
      },
    };
    for (const { platformType, adapterKey } of MARKETPLACES) {
      registry.register({
        adapterKey,
        platformType,
        supportedCapabilities: ['OrderSource'],
        displayName: `${platformType} OrderSource (catalogue-less test stub)`,
        version: '0.0.0-test',
        isDefault: false,
      });
      factoryResolver.registerFactory(adapterKey, {
        createCapabilityAdapter: <T>(): Promise<T> => Promise.resolve(sourceStub as unknown as T),
      });
    }
  });

  afterEach(async () => {
    sourceResponses.clear();
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  describe.each(MARKETPLACES)('$platformType as the only connection', ({ platformType, adapterKey }) => {
    it('should ingest an order with no ProductMaster to ready and keep its lines keyed by offer id', async () => {
      const dataSource = harness.getDataSource();
      const connection = await createTestConnection(dataSource, {
        platformType,
        name: `${platformType} source`,
        adapterKey,
        enabledCapabilities: ['OrderSource'],
        config: { catalogueMode: 'none' },
      });
      sourceResponses.set('order-1', makeIncoming('order-1'));

      // No other connection exists, so there is no destination to mirror to; the
      // job must still complete (#3959) rather than throw and retry.
      await expect(ingestion.syncOrderFromSource(connection.id, 'order-1')).resolves.toEqual([]);

      const records = await dataSource.getRepository(OrderRecordOrmEntity).find();
      expect(records).toHaveLength(1);
      expect(records[0].recordStatus).toBe('ready');
      expect(records[0].sourceConnectionId).toBe(connection.id);

      const lines = await dataSource
        .getRepository(OrderLineItemOrmEntity)
        .find({ order: { lineNumber: 'ASC' } });
      expect(lines.map((line) => line.productId)).toEqual([
        `unmatched:${connection.id}:9788328345`,
        `unmatched:${connection.id}:5901234567`,
      ]);
      expect(lines.every((line) => line.variantId === null)).toBe(true);
      expect(lines.map((line) => line.quantity)).toEqual([1, 2]);
      // The channel's own tax rate is kept; nothing read a catalogue.
      expect(lines[0].taxRate).toBe('23');
    });

    it('should keep today\'s awaiting_mapping behaviour when the mode is not set', async () => {
      const dataSource = harness.getDataSource();
      const connection = await createTestConnection(dataSource, {
        platformType,
        name: `${platformType} source (default)`,
        adapterKey,
        enabledCapabilities: ['OrderSource'],
        config: {},
      });
      sourceResponses.set('order-2', makeIncoming('order-2'));

      await ingestion.syncOrderFromSource(connection.id, 'order-2');

      const records = await dataSource.getRepository(OrderRecordOrmEntity).find();
      expect(records).toHaveLength(1);
      expect(records[0].recordStatus).toBe('awaiting_mapping');
      expect(await dataSource.getRepository(OrderLineItemOrmEntity).count()).toBe(0);
    });
  });

  it('should reproduce the same synthetic ids when the same order is re-ingested', async () => {
    const dataSource = harness.getDataSource();
    const connection = await createTestConnection(dataSource, {
      platformType: 'allegro',
      name: 'allegro source',
      adapterKey: MARKETPLACES[0].adapterKey,
      enabledCapabilities: ['OrderSource'],
      config: { catalogueMode: 'none' },
    });
    sourceResponses.set('order-3', makeIncoming('order-3'));

    await ingestion.syncOrderFromSource(connection.id, 'order-3');
    await ingestion.syncOrderFromSource(connection.id, 'order-3');

    // Delete-then-reinsert per order: re-ingestion never duplicates lines.
    const lines = await dataSource
      .getRepository(OrderLineItemOrmEntity)
      .find({ order: { lineNumber: 'ASC' } });
    expect(lines.map((line) => line.productId)).toEqual([
      `unmatched:${connection.id}:9788328345`,
      `unmatched:${connection.id}:5901234567`,
    ]);
  });
});
