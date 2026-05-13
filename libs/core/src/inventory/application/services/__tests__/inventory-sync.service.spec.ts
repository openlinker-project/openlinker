/**
 * Inventory Sync Service Tests
 *
 * Unit tests for InventorySyncService. Focus on batch-vs-single behavior and partial failures.
 *
 * @module libs/core/src/inventory/application/services/__tests__
 */

import { InventorySyncService } from '../inventory-sync.service';
import { OfferManagerPort, OfferQuantityBatchUpdater } from '@openlinker/core/listings';
import { IIntegrationsService } from '@openlinker/core/integrations';

describe('InventorySyncService', () => {
  let service: InventorySyncService;
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let marketplace: jest.Mocked<OfferManagerPort & OfferQuantityBatchUpdater>;

  const connectionId = 'connection-123';

  beforeEach(() => {
    marketplace = {
      listOrderFeed: jest.fn(),
      getOrder: jest.fn(),
      updateOfferQuantity: jest.fn(),
      updateOfferQuantitiesBatch: jest.fn(),
    } as unknown as jest.Mocked<OfferManagerPort & OfferQuantityBatchUpdater>;

    integrationsService = {
      getCapabilityAdapter: jest.fn().mockResolvedValue(marketplace),
      getAdapter: jest.fn(),
      listCapabilityAdapters: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

    service = new InventorySyncService(integrationsService);
  });

  it('uses batch API when available and multiple items provided', async () => {
    (marketplace.updateOfferQuantitiesBatch as unknown as jest.Mock).mockResolvedValueOnce({
      succeeded: ['o1', 'o2'],
      failed: [],
    });

    const result = await service.updateOfferQuantities(connectionId, {
      items: [
        { offerId: 'o1', quantity: 1, idempotencyKey: 'k1' },
        { offerId: 'o2', quantity: 2, idempotencyKey: 'k2' },
      ],
    });

    expect(marketplace.updateOfferQuantitiesBatch).toHaveBeenCalledTimes(1);
    expect(marketplace.updateOfferQuantity).not.toHaveBeenCalled();
    expect(result).toEqual({ succeeded: ['o1', 'o2'], failed: [] });
  });

  it('falls back to per-item updates and reports partial failures', async () => {
    // Make batch fail so service falls back to per-item
    (marketplace.updateOfferQuantitiesBatch as unknown as jest.Mock).mockRejectedValueOnce(
      new Error('batch failed'),
    );
    marketplace.updateOfferQuantity
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('boom'));

    const result = await service.updateOfferQuantities(connectionId, {
      items: [
        { offerId: 'o1', quantity: 1, idempotencyKey: 'k1' },
        { offerId: 'o2', quantity: 2, idempotencyKey: 'k2' },
      ],
    });

    expect(marketplace.updateOfferQuantity).toHaveBeenCalledTimes(2);
    expect(result.succeeded).toEqual(['o1']);
    expect(result.failed).toEqual([
      { offerId: 'o2', errorCode: 'unknown', message: 'boom' },
    ]);
  });

  it('should short-circuit with an empty result when items is empty (no adapter resolution)', async () => {
    const result = await service.updateOfferQuantities(connectionId, { items: [] });

    expect(result).toEqual({ succeeded: [], failed: [] });
    expect(integrationsService.getCapabilityAdapter).not.toHaveBeenCalled();
    expect(marketplace.updateOfferQuantitiesBatch).not.toHaveBeenCalled();
    expect(marketplace.updateOfferQuantity).not.toHaveBeenCalled();
  });

  it('should delegate updateOfferQuantity to updateOfferQuantities for the single-item path', async () => {
    // Single item path: never batched (batch is gated to length > 1), goes through per-item loop.
    marketplace.updateOfferQuantity.mockResolvedValueOnce(undefined);

    const result = await service.updateOfferQuantity(connectionId, {
      offerId: 'o1',
      quantity: 7,
      idempotencyKey: 'k1',
    });

    expect(marketplace.updateOfferQuantitiesBatch).not.toHaveBeenCalled();
    expect(marketplace.updateOfferQuantity).toHaveBeenCalledTimes(1);
    expect(marketplace.updateOfferQuantity).toHaveBeenCalledWith({
      offerId: 'o1',
      quantity: 7,
      idempotencyKey: 'k1',
    });
    expect(result).toEqual({ succeeded: ['o1'], failed: [] });
  });

  it('should force per-item updates when the adapter does not implement OfferQuantityBatchUpdater', async () => {
    // Construct a marketplace adapter that lacks updateOfferQuantitiesBatch entirely —
    // isOfferQuantityBatchUpdater() checks `typeof obj.updateOfferQuantitiesBatch === 'function'`,
    // so omitting the key makes the guard return false and forces the per-item path.
    const minimalMarketplace = {
      updateOfferQuantity: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<OfferManagerPort>;
    integrationsService.getCapabilityAdapter.mockResolvedValueOnce(minimalMarketplace);

    const result = await service.updateOfferQuantities(connectionId, {
      items: [
        { offerId: 'o1', quantity: 1, idempotencyKey: 'k1' },
        { offerId: 'o2', quantity: 2, idempotencyKey: 'k2' },
      ],
    });

    expect(minimalMarketplace.updateOfferQuantity).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ succeeded: ['o1', 'o2'], failed: [] });
  });

  it('should auto-generate a deterministic idempotency key when an item omits one', async () => {
    // Single-item path (length === 1) forces per-item loop, which lets us inspect the
    // normalized item passed to updateOfferQuantity. The key is a SHA-256 truncation
    // of (connectionId, offerId, quantity) — same tuple → same key, distinct tuple → distinct key.
    marketplace.updateOfferQuantity.mockResolvedValue(undefined);

    await service.updateOfferQuantities(connectionId, {
      items: [{ offerId: 'o1', quantity: 7 }],
    });
    await service.updateOfferQuantities(connectionId, {
      items: [{ offerId: 'o1', quantity: 7 }],
    });

    expect(marketplace.updateOfferQuantity).toHaveBeenCalledTimes(2);
    const firstCallArg = marketplace.updateOfferQuantity.mock.calls[0][0];
    const secondCallArg = marketplace.updateOfferQuantity.mock.calls[1][0];

    expect(firstCallArg.idempotencyKey).toMatch(/^inv:[a-f0-9]{16}$/);
    // Same (connectionId, offerId, quantity) tuple → same key. Deterministic SHA-256 truncation.
    expect(secondCallArg.idempotencyKey).toBe(firstCallArg.idempotencyKey);

    // Distinct quantity → distinct key.
    await service.updateOfferQuantities(connectionId, {
      items: [{ offerId: 'o1', quantity: 8 }],
    });
    const thirdCallArg = marketplace.updateOfferQuantity.mock.calls[2][0];
    expect(thirdCallArg.idempotencyKey).toMatch(/^inv:[a-f0-9]{16}$/);
    expect(thirdCallArg.idempotencyKey).not.toBe(firstCallArg.idempotencyKey);
  });
});

