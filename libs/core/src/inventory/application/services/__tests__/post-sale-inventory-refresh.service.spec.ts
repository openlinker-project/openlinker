/**
 * PostSaleInventoryRefreshService unit tests
 *
 * The behaviour that matters here is the dedupe KEY: it is what decides
 * whether a second refresh can ever happen after the document that actually
 * moved the stock committed. The `order:` scope is pinned byte for byte
 * because it predates this service and must not change.
 *
 * @module libs/core/src/inventory/application/services/__tests__
 */
import type { IIdentifierMappingService } from '@openlinker/core/identifier-mapping';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { SyncJobQueuePort } from '@openlinker/core/sync';
import {
  PostSaleInventoryRefreshService,
  buildPostSaleInventoryRefreshKey,
} from '../post-sale-inventory-refresh.service';

const MASTER_CONN = 'master-conn';

describe('PostSaleInventoryRefreshService', () => {
  let integrationsService: jest.Mocked<Pick<IIntegrationsService, 'listCapabilityAdapters'>>;
  let identifierMapping: jest.Mocked<Pick<IIdentifierMappingService, 'getExternalIds'>>;
  let jobQueue: jest.Mocked<SyncJobQueuePort>;
  let service: PostSaleInventoryRefreshService;

  const withMaster = (connectionId: string | null): void => {
    integrationsService.listCapabilityAdapters.mockResolvedValue(
      connectionId
        ? [
            {
              connectionId,
              connection: {} as never,
              adapter: {} as never,
              metadata: {} as never,
            },
          ]
        : []
    );
  };

  const withMapping = (connectionId: string, externalId: string): void => {
    identifierMapping.getExternalIds.mockResolvedValue([
      { externalId, connectionId, platformType: 'subiekt-gt', entityType: 'Product' },
    ]);
  };

  beforeEach(() => {
    integrationsService = { listCapabilityAdapters: jest.fn() } as never;
    identifierMapping = { getExternalIds: jest.fn().mockResolvedValue([]) } as never;
    jobQueue = {
      enqueue: jest.fn().mockResolvedValue('job-id'),
      enqueueBulk: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<SyncJobQueuePort>;
    service = new PostSaleInventoryRefreshService(
      integrationsService as unknown as IIntegrationsService,
      identifierMapping as unknown as IIdentifierMappingService,
      jobQueue
    );
  });

  it('builds the order-scoped key exactly as it was before this service existed', () => {
    // A regression pin, not a tautology: an order mid-flight across the deploy
    // must dedupe against the key its earlier attempt already spent.
    expect(buildPostSaleInventoryRefreshKey('order:ol_order_123', 'master-conn', 'PS-789')).toBe(
      'order:ol_order_123:inventory:sync:master-conn:PS-789'
    );
  });

  it('enqueues one re-read per mapped product at an InventoryMaster connection', async () => {
    withMaster(MASTER_CONN);
    withMapping(MASTER_CONN, 'DZSO100');

    await service.enqueue({ productIds: ['ol_product_1'], keyScope: 'order:ol_order_1' });

    expect(jobQueue.enqueue).toHaveBeenCalledWith({
      type: 'master.inventory.syncByExternalId',
      connectionId: MASTER_CONN,
      payload: { schemaVersion: 1, externalId: 'DZSO100', objectType: 'Inventory' },
      options: { dedupeKey: 'order:ol_order_1:inventory:sync:master-conn:DZSO100' },
    });
  });

  it('gives the SAME product a different key under the document scope, so it can fire again', async () => {
    withMaster(MASTER_CONN);
    withMapping(MASTER_CONN, 'DZSO100');

    await service.enqueue({ productIds: ['ol_product_1'], keyScope: 'order:ol_order_1' });
    await service.enqueue({ productIds: ['ol_product_1'], keyScope: 'invoice:inv-record-1' });

    const keys = jobQueue.enqueue.mock.calls.map((c) => c[0].options?.dedupeKey);
    expect(keys).toEqual([
      'order:ol_order_1:inventory:sync:master-conn:DZSO100',
      'invoice:inv-record-1:inventory:sync:master-conn:DZSO100',
    ]);
    // This is the whole fix: the document-scoped read happens AFTER the stock
    // moved, and a spent order-scoped key cannot suppress it.
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('is idempotent within one scope — a repeated call reuses the same key', async () => {
    withMaster(MASTER_CONN);
    withMapping(MASTER_CONN, 'DZSO100');

    await service.enqueue({ productIds: ['ol_product_1'], keyScope: 'invoice:inv-1' });
    await service.enqueue({ productIds: ['ol_product_1'], keyScope: 'invoice:inv-1' });

    const keys = jobQueue.enqueue.mock.calls.map((c) => c[0].options?.dedupeKey);
    expect(new Set(keys).size).toBe(1);
  });

  it('enqueues nothing when no InventoryMaster-capable connection exists', async () => {
    withMaster(null);

    await service.enqueue({ productIds: ['ol_product_1'], keyScope: 'order:ol_order_1' });

    expect(jobQueue.enqueue).not.toHaveBeenCalled();
  });

  it('enqueues nothing for a product mapped only at a NON-master connection', async () => {
    withMaster(MASTER_CONN);
    withMapping('some-other-conn', 'DZSO100');

    await service.enqueue({ productIds: ['ol_product_1'], keyScope: 'order:ol_order_1' });

    expect(jobQueue.enqueue).not.toHaveBeenCalled();
  });

  it('ignores blank and duplicate product ids without touching the registry', async () => {
    await service.enqueue({ productIds: ['', ''], keyScope: 'order:ol_order_1' });

    expect(integrationsService.listCapabilityAdapters).not.toHaveBeenCalled();
    expect(jobQueue.enqueue).not.toHaveBeenCalled();
  });

  it('de-duplicates a product that appears on several order lines', async () => {
    withMaster(MASTER_CONN);
    withMapping(MASTER_CONN, 'DZSO100');

    await service.enqueue({
      productIds: ['ol_product_1', 'ol_product_1'],
      keyScope: 'order:ol_order_1',
    });

    expect(jobQueue.enqueue).toHaveBeenCalledTimes(1);
  });

  it('does not let one product’s failed lookup suppress another product’s enqueue', async () => {
    withMaster(MASTER_CONN);
    identifierMapping.getExternalIds.mockImplementation((_type, internalId) =>
      internalId === 'ol_product_bad'
        ? Promise.reject(new Error('mapping store down'))
        : Promise.resolve([
            {
              externalId: 'DZSO100',
              connectionId: MASTER_CONN,
              platformType: 'subiekt-gt',
              entityType: 'Product',
            },
          ])
    );

    await service.enqueue({
      productIds: ['ol_product_bad', 'ol_product_ok'],
      keyScope: 'order:ol_order_1',
    });

    expect(jobQueue.enqueue).toHaveBeenCalledTimes(1);
  });

  it('never throws when the capability registry lookup itself rejects', async () => {
    integrationsService.listCapabilityAdapters.mockRejectedValue(new Error('registry unavailable'));

    await expect(
      service.enqueue({ productIds: ['ol_product_1'], keyScope: 'invoice:inv-1' })
    ).resolves.toBeUndefined();
    expect(jobQueue.enqueue).not.toHaveBeenCalled();
  });

  it('never throws when the queue itself rejects — the sweep is the backstop', async () => {
    withMaster(MASTER_CONN);
    withMapping(MASTER_CONN, 'DZSO100');
    jobQueue.enqueue.mockRejectedValue(new Error('queue unavailable'));

    await expect(
      service.enqueue({ productIds: ['ol_product_1'], keyScope: 'invoice:inv-1' })
    ).resolves.toBeUndefined();
  });
});
