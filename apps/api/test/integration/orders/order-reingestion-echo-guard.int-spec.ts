/**
 * Order Re-ingestion Echo-Guard Int-Spec (#940 / ADR-017)
 *
 * Reproduces the destination-echo regression end-to-end against the real
 * Postgres harness: an order that originated on Allegro is pushed into
 * PrestaShop as a sync destination, then the PrestaShop reconciliation poll
 * re-reads that PrestaShop order. Before the guard, `syncOrderFromSource`
 * resolved the existing internal order (via the destination identifier
 * mapping) and overwrote its `sourceConnectionId`/`sourceEventId`/snapshot
 * while resetting `syncStatus` — flipping the order's channel to PrestaShop
 * and dropping it out of fulfillment reconciliation.
 *
 * This slice exercises the REAL identifier-mapping resolution and REAL
 * OrderRecord persistence — the layers the unit spec mocks, and exactly
 * where the bug lived. Only the `OrderSource` adapter is stubbed, via the
 * public `AdapterRegistryService` + `AdapterFactoryResolverService` seam
 * (#570/#574), so no PrestaShop container is required. The guard's other
 * branches (no existing record; same-source reconcile) are covered
 * deterministically by the unit spec.
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
  CORE_ENTITY_TYPE,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  IIdentifierMappingService,
} from '@openlinker/core/identifier-mapping';
import {
  IOrderIngestionService,
  ORDER_INGESTION_SERVICE_TOKEN,
  type IncomingOrder,
  type OrderSourcePort,
} from '@openlinker/core/orders';
import { OrderRecordOrmEntity } from '@openlinker/core/orders/orm-entities';
import { getTestHarness, IntegrationTestHarness, resetTestHarness, teardownTestHarness } from '../setup';
import { createTestConnection } from '../helpers/test-connection.helper';
import { createTestOrderRecord } from '../fixtures/order.fixtures';

const PS_SOURCE_STUB_KEY = 'prestashop.test.echo.v1';

function makeIncoming(externalOrderId: string, status: string): IncomingOrder {
  return {
    externalOrderId,
    orderNumber: externalOrderId,
    status,
    items: [],
    totals: { subtotal: 0, tax: 0, shipping: 0, total: 0, currency: 'PLN' },
    createdAt: '2026-06-01T00:19:00.000Z',
    updatedAt: '2026-06-01T05:20:00.000Z',
  } as IncomingOrder;
}

describe('Order re-ingestion echo guard (#940)', () => {
  let harness: IntegrationTestHarness;
  let ingestion: IOrderIngestionService;
  let identifierMapping: IIdentifierMappingService;
  // Per-test programmable PrestaShop `OrderSource.getOrder` responses, keyed by external id.
  const psSourceResponses = new Map<string, IncomingOrder>();

  beforeAll(async () => {
    harness = await getTestHarness();
    ingestion = harness.getApp().get<IOrderIngestionService>(ORDER_INGESTION_SERVICE_TOKEN);
    identifierMapping = harness
      .getApp()
      .get<IIdentifierMappingService>(IDENTIFIER_MAPPING_SERVICE_TOKEN);

    // Register a synthetic PrestaShop OrderSource adapter via the same public
    // seam real plugins use. Process-lifetime, intentionally not unregistered
    // (the registry throws on duplicate adapterKey) — mirrors the Allegro source
    // stub precedent. Survives resetTestHarness (which only truncates the DB).
    // `isDefault: false` keeps the real prestashop default adapter intact. The
    // connection sets this adapterKey explicitly.
    const registry = harness.getApp().get<AdapterRegistryPort>(ADAPTER_REGISTRY_TOKEN);
    const factoryResolver = harness
      .getApp()
      .get<AdapterFactoryResolverService>(ADAPTER_FACTORY_RESOLVER_TOKEN);

    const psSourceStub: OrderSourcePort = {
      listOrderFeed: () => Promise.resolve({ items: [], nextCursor: null }),
      getOrder: ({ externalOrderId }) => {
        const incoming = psSourceResponses.get(externalOrderId);
        return incoming
          ? Promise.resolve(incoming)
          : Promise.reject(
              new Error(`PS echo stub: no IncomingOrder registered for ${externalOrderId}`)
            );
      },
    };

    registry.register({
      adapterKey: PS_SOURCE_STUB_KEY,
      platformType: 'prestashop',
      supportedCapabilities: ['OrderSource'],
      displayName: 'PrestaShop OrderSource (echo-guard test stub)',
      version: '0.0.0-test',
      isDefault: false,
    });
    factoryResolver.registerFactory(PS_SOURCE_STUB_KEY, {
      createCapabilityAdapter: <T>(): Promise<T> => Promise.resolve(psSourceStub as unknown as T),
    });
  });

  afterEach(async () => {
    psSourceResponses.clear();
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('skips re-ingestion and preserves source attribution + sync history when re-reading an order it created as a destination', async () => {
    const dataSource = harness.getDataSource();

    // An Allegro source connection and a PrestaShop connection that doubles as
    // an OrderSource (the destination shop the poll re-reads).
    const allegroConnection = await createTestConnection(dataSource, {
      platformType: 'allegro',
      name: 'Allegro source',
      adapterKey: 'allegro.test.unused',
    });
    const prestashopConnection = await createTestConnection(dataSource, {
      platformType: 'prestashop',
      name: 'PrestaShop destination',
      adapterKey: PS_SOURCE_STUB_KEY,
      enabledCapabilities: ['OrderSource'],
    });

    const allegroOrderId = 'allegro-checkout-abc';
    const prestashopOrderId = '7';
    const internalOrderId = 'ol_order_echo_guard_test';

    // Mimic the post-sync identity state: the Allegro source mapping (created at
    // ingest) and the PrestaShop destination mapping (created by OrderSyncService
    // when the order was pushed into PrestaShop) both point at one internal order.
    // The guard reads `record.sourceConnectionId`, not these mappings — the
    // Allegro mapping is seeded for scenario realism; the PS destination mapping
    // is what makes `getOrCreateInternalId(Order, '7', PS)` resolve to the
    // existing order rather than minting a new one.
    await identifierMapping.createMapping(
      CORE_ENTITY_TYPE.Order,
      allegroOrderId,
      allegroConnection.id,
      internalOrderId
    );
    await identifierMapping.createMapping(
      CORE_ENTITY_TYPE.Order,
      prestashopOrderId,
      prestashopConnection.id,
      internalOrderId
    );

    // The OrderRecord as it stands after a successful Allegro → PrestaShop sync:
    // source = Allegro, synced to the PrestaShop destination.
    await createTestOrderRecord(dataSource, {
      internalOrderId,
      sourceConnectionId: allegroConnection.id,
      sourceEventId: 'allegro-evt-1',
      orderSnapshot: { status: 'BOUGHT', orderNumber: allegroOrderId, items: [] },
      recordStatus: 'ready',
      syncStatus: [
        {
          destinationConnectionId: prestashopConnection.id,
          status: 'synced',
          syncedAt: '2026-06-01T00:19:52.000Z',
          externalOrderId: prestashopOrderId,
          externalOrderNumber: prestashopOrderId,
        },
      ],
    });

    // PrestaShop's projected view of the same order (a different status — what
    // an overwrite would have written onto the record).
    psSourceResponses.set(prestashopOrderId, makeIncoming(prestashopOrderId, 'PS_SHIPPED'));

    // Act: the PrestaShop poll re-ingests its own (OL-created) order.
    const result = await ingestion.syncOrderFromSource(
      prestashopConnection.id,
      prestashopOrderId
    );

    // The echo is a no-op.
    expect(result).toEqual([]);

    const recordRepo = dataSource.getRepository(OrderRecordOrmEntity);
    const found = await recordRepo.findOne({ where: { internalOrderId } });

    expect(found).not.toBeNull();
    // Source attribution is untouched — still Allegro, not PrestaShop.
    expect(found!.sourceConnectionId).toBe(allegroConnection.id);
    expect(found!.sourceEventId).toBe('allegro-evt-1');
    // Snapshot not overwritten with PrestaShop's projected status.
    expect(found!.orderSnapshot.status).toBe('BOUGHT');
    // Sync history preserved (a reset to [] would also break fulfillment sync).
    expect(found!.syncStatus).toHaveLength(1);
    expect(found!.syncStatus[0].destinationConnectionId).toBe(prestashopConnection.id);
    expect(found!.syncStatus[0].status).toBe('synced');

    // No duplicate internal order was minted; the PS external id still resolves
    // to the original internal order.
    expect(await recordRepo.count()).toBe(1);
    expect(
      await identifierMapping.getInternalId(
        CORE_ENTITY_TYPE.Order,
        prestashopOrderId,
        prestashopConnection.id
      )
    ).toBe(internalOrderId);
  });
});
