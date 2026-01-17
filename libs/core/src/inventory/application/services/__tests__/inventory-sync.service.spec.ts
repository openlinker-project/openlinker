/**
 * Inventory Sync Service Tests
 *
 * Unit tests for InventorySyncService. Focus on batch-vs-single behavior and partial failures.
 *
 * @module libs/core/src/inventory/application/services/__tests__
 */

import { InventorySyncService } from '../inventory-sync.service';
import { IIntegrationsService, MarketplacePort } from '@openlinker/core/integrations';

describe('InventorySyncService', () => {
  let service: InventorySyncService;
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let marketplace: jest.Mocked<MarketplacePort>;

  const connectionId = 'connection-123';

  beforeEach(() => {
    marketplace = {
      listOrderFeed: jest.fn(),
      getOrder: jest.fn(),
      updateOfferQuantity: jest.fn(),
      updateOfferQuantitiesBatch: jest.fn(),
    } as unknown as jest.Mocked<MarketplacePort>;

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
});

