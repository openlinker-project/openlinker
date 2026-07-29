/**
 * Inventory Service Tests
 *
 * Unit tests for InventoryService. Focus on propagation enqueue behavior
 * after canonical inventory writes.
 *
 * @module libs/core/src/inventory/application/services/__tests__
 */

import { InventoryService } from '../inventory.service';
import type { InventoryRepositoryPort } from '../../../domain/ports/inventory-repository.port';
import { InventoryItem } from '../../../domain/entities/inventory-item.entity';
import type { SyncJobQueuePort } from '@openlinker/core/sync';

describe('InventoryService', () => {
  let service: InventoryService;
  let inventoryRepository: jest.Mocked<InventoryRepositoryPort>;
  let jobQueue: jest.Mocked<SyncJobQueuePort>;

  const createItem = (overrides?: Partial<InventoryItem>): InventoryItem => {
    const base = new InventoryItem(
      'inventory-id',
      'product-id',
      null,
      5,
      0,
      null,
      new Date('2026-01-01T10:00:00.000Z')
    );

    return new InventoryItem(
      overrides?.id ?? base.id,
      overrides?.productId ?? base.productId,
      overrides?.productVariantId ?? base.productVariantId,
      overrides?.availableQuantity ?? base.availableQuantity,
      overrides?.reservedQuantity ?? base.reservedQuantity,
      overrides?.locationId ?? base.locationId,
      overrides?.updatedAt ?? base.updatedAt
    );
  };

  beforeEach(() => {
    inventoryRepository = {
      findByProductAndVariant: jest.fn(),
      upsert: jest.fn(),
      markStaleExceptVariants: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<InventoryRepositoryPort>;

    jobQueue = {
      enqueue: jest.fn().mockResolvedValue('job-id'),
      enqueueBulk: jest.fn(),
    } as unknown as jest.Mocked<SyncJobQueuePort>;

    service = new InventoryService(inventoryRepository, jobQueue);
  });

  it('enqueues inventory propagation when quantity changes', async () => {
    const input = createItem({
      availableQuantity: 7,
      updatedAt: new Date('2026-01-01T12:00:00.000Z'),
    });
    const previous = createItem({
      availableQuantity: 5,
      updatedAt: new Date('2026-01-01T11:00:00.000Z'),
    });

    inventoryRepository.findByProductAndVariant.mockResolvedValue(previous);
    inventoryRepository.upsert.mockResolvedValue(input);

    await service.setInventory(input);

    expect(jobQueue.enqueue).toHaveBeenCalledWith({
      type: 'inventory.propagateToMarketplaces',
      connectionId: '00000000-0000-0000-0000-000000000000',
      payload: {
        productId: 'product-id',
        variantId: null,
        inventoryUpdatedAt: '2026-01-01T12:00:00.000Z',
      },
      options: {
        dedupeKey: 'inventory:propagate:product-id:base:2026-01-01T12:00:00.000Z',
      },
    });
  });

  it('skips enqueue when available quantity is unchanged', async () => {
    const input = createItem({
      availableQuantity: 5,
      updatedAt: new Date('2026-01-01T12:00:00.000Z'),
    });
    const previous = createItem({
      availableQuantity: 5,
      updatedAt: new Date('2026-01-01T11:00:00.000Z'),
    });

    inventoryRepository.findByProductAndVariant.mockResolvedValue(previous);
    inventoryRepository.upsert.mockResolvedValue(input);

    await service.setInventory(input);

    expect(jobQueue.enqueue).not.toHaveBeenCalled();
  });

  it('skips enqueue for non-default location inventory', async () => {
    const input = createItem({
      locationId: 'warehouse-a',
      availableQuantity: 7,
    });

    inventoryRepository.findByProductAndVariant.mockResolvedValue(null);
    inventoryRepository.upsert.mockResolvedValue(input);

    await service.setInventory(input);

    expect(jobQueue.enqueue).not.toHaveBeenCalled();
  });

  it('throws when enqueue fails after upsert', async () => {
    const input = createItem({
      availableQuantity: 7,
      updatedAt: new Date('2026-01-01T12:00:00.000Z'),
    });

    inventoryRepository.findByProductAndVariant.mockResolvedValue(null);
    inventoryRepository.upsert.mockResolvedValue(input);
    jobQueue.enqueue.mockRejectedValue(new Error('queue unavailable'));

    await expect(service.setInventory(input)).rejects.toThrow(
      'Failed to enqueue inventory propagation job: queue unavailable'
    );
  });

  it('does not enqueue when upsert fails', async () => {
    const input = createItem({
      availableQuantity: 7,
    });

    inventoryRepository.findByProductAndVariant.mockResolvedValue(null);
    inventoryRepository.upsert.mockRejectedValue(new Error('db error'));

    await expect(service.setInventory(input)).rejects.toThrow('db error');
    expect(jobQueue.enqueue).not.toHaveBeenCalled();
  });

  it('enqueues both updates for 5->6->5 transitions', async () => {
    const first = createItem({
      availableQuantity: 6,
      updatedAt: new Date('2026-01-01T12:00:00.000Z'),
    });
    const second = createItem({
      availableQuantity: 5,
      updatedAt: new Date('2026-01-01T12:05:00.000Z'),
    });

    inventoryRepository.findByProductAndVariant
      .mockResolvedValueOnce(createItem({ availableQuantity: 5 }))
      .mockResolvedValueOnce(createItem({ availableQuantity: 6 }));
    inventoryRepository.upsert.mockResolvedValueOnce(first).mockResolvedValueOnce(second);

    await service.setInventory(first);
    await service.setInventory(second);

    expect(jobQueue.enqueue).toHaveBeenCalledTimes(2);
    expect(jobQueue.enqueue).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        options: {
          dedupeKey: 'inventory:propagate:product-id:base:2026-01-01T12:00:00.000Z',
        },
      })
    );
    expect(jobQueue.enqueue).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        options: {
          dedupeKey: 'inventory:propagate:product-id:base:2026-01-01T12:05:00.000Z',
        },
      })
    );
  });

  it('delegates pruneStaleVariants to the repository and returns the prune result', async () => {
    (inventoryRepository.markStaleExceptVariants as jest.Mock).mockResolvedValue({
      markedCount: 3,
      variantIds: ['ol_variant_b'],
    });

    const result = await service.pruneStaleVariants('product-id', ['ol_variant_a', null]);

    expect(inventoryRepository.markStaleExceptVariants).toHaveBeenCalledWith('product-id', [
      'ol_variant_a',
      null,
    ]);
    expect(result).toEqual({ markedCount: 3, variantIds: ['ol_variant_b'] });
  });

  it('uses persisted updatedAt as write event token', async () => {
    const input = createItem({
      availableQuantity: 7,
      updatedAt: new Date('2026-01-01T10:00:00.000Z'),
    });
    const persisted = createItem({
      availableQuantity: 7,
      updatedAt: new Date('2026-01-01T12:00:00.000Z'),
    });

    inventoryRepository.findByProductAndVariant.mockResolvedValue(null);
    inventoryRepository.upsert.mockResolvedValue(persisted);

    await service.setInventory(input);

    expect(jobQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          inventoryUpdatedAt: '2026-01-01T12:00:00.000Z',
        }),
        options: expect.objectContaining({
          dedupeKey: 'inventory:propagate:product-id:base:2026-01-01T12:00:00.000Z',
        }),
      })
    );
  });
});
