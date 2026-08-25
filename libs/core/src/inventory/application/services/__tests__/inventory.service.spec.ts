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
      overrides?.updatedAt ?? base.updatedAt,
      overrides?.isStale ?? base.isStale,
      overrides?.sourceConnectionId ?? base.sourceConnectionId
    );
  };

  beforeEach(() => {
    inventoryRepository = {
      findByProductAndVariant: jest.fn(),
      upsert: jest.fn(),
      markStaleExceptVariants: jest.fn().mockResolvedValue(0),
      markLocationlessStaleForSource: jest.fn().mockResolvedValue({ markedCount: 0, variantIds: [] }),
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

  // B1 (#2320) — the no-change guard's `previous` lookup MUST carry the same
  // provenance axis `upsert`'s own lookup derives from the item. Unscoped, the
  // two reads can resolve DIFFERENT rows in a two-master configuration, so the
  // guard compares a foreign connection's quantity against ours: it suppresses
  // a propagation whose aggregate really did change, nondeterministically.
  it('scopes the previous-row lookup to the item source connection', async () => {
    const input = createItem({
      availableQuantity: 7,
      sourceConnectionId: 'connection-a',
      updatedAt: new Date('2026-01-01T12:00:00.000Z'),
    });

    inventoryRepository.findByProductAndVariant.mockResolvedValue(null);
    inventoryRepository.upsert.mockResolvedValue(input);

    await service.setInventory(input);

    expect(inventoryRepository.findByProductAndVariant).toHaveBeenCalledWith(
      'product-id',
      null,
      null,
      'connection-a'
    );
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

  // #2324 (ADR-058 decision 5) — INVERTED. A located write used to be skipped,
  // which meant a locating master never propagated at all.
  it('enqueues propagation for a located write', async () => {
    const input = createItem({
      productVariantId: 'variant-1',
      locationId: 'warehouse-a',
      availableQuantity: 7,
      updatedAt: new Date('2026-01-01T12:00:00.000Z'),
    });

    inventoryRepository.findByProductAndVariant.mockResolvedValue(null);
    inventoryRepository.upsert.mockResolvedValue(input);

    await service.setInventory(input);

    expect(jobQueue.enqueue).toHaveBeenCalledTimes(1);
    expect(jobQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'inventory.propagateToMarketplaces',
        payload: {
          productId: 'product-id',
          variantId: 'variant-1',
          inventoryUpdatedAt: '2026-01-01T12:00:00.000Z',
        },
        options: {
          // Variant-keyed and LOCATION-FREE: the location is deliberately
          // absent from the key.
          dedupeKey: 'inventory:propagate:product-id:variant-1:2026-01-01T12:00:00.000Z',
        },
      })
    );
  });

  it('collapses sibling located writes sharing an updatedAt onto one dedupe key', async () => {
    const updatedAt = new Date('2026-01-01T12:00:00.000Z');
    const keys: string[] = [];

    for (const locationId of ['warehouse-a', 'warehouse-b', 'warehouse-c']) {
      const input = createItem({
        productVariantId: 'variant-1',
        locationId,
        availableQuantity: 3,
        updatedAt,
      });
      inventoryRepository.findByProductAndVariant.mockResolvedValue(null);
      inventoryRepository.upsert.mockResolvedValue(input);
      await service.setInventory(input);
    }

    for (const call of jobQueue.enqueue.mock.calls) {
      keys.push((call[0] as { options: { dedupeKey: string } }).options.dedupeKey);
    }

    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(1);
  });

  it('still suppresses a located write whose own row quantity did not change', async () => {
    const input = createItem({
      productVariantId: 'variant-1',
      locationId: 'warehouse-a',
      availableQuantity: 5,
      updatedAt: new Date('2026-01-01T12:00:00.000Z'),
    });
    const previous = createItem({
      productVariantId: 'variant-1',
      locationId: 'warehouse-a',
      availableQuantity: 5,
      updatedAt: new Date('2026-01-01T11:00:00.000Z'),
    });

    inventoryRepository.findByProductAndVariant.mockResolvedValue(previous);
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

    // `undefined` is forwarded verbatim rather than normalised: the repository
    // distinguishes "no provenance scope" from every real value (#2320).
    expect(inventoryRepository.markStaleExceptVariants).toHaveBeenCalledWith(
      'product-id',
      ['ol_variant_a', null],
      undefined
    );
    expect(result).toEqual({ markedCount: 3, variantIds: ['ol_variant_b'] });
  });

  it('forwards a provenance scope to the repository prune verbatim (#2320)', async () => {
    (inventoryRepository.markStaleExceptVariants as jest.Mock).mockResolvedValue({
      markedCount: 0,
      variantIds: [],
    });
    const scope = { sourceConnectionId: 'conn-alpha', includeUnattributedProvenance: true };

    await service.pruneStaleVariants('product-id', [], scope);

    expect(inventoryRepository.markStaleExceptVariants).toHaveBeenCalledWith(
      'product-id',
      [],
      scope
    );
  });

  it('forwards the getInventory provenance axis verbatim, undefined included (#2320)', async () => {
    (inventoryRepository.findByProductAndVariant as jest.Mock).mockResolvedValue(null);

    await service.getInventory('product-id', 'ol_variant_a', null, 'conn-alpha');
    expect(inventoryRepository.findByProductAndVariant).toHaveBeenLastCalledWith(
      'product-id',
      'ol_variant_a',
      null,
      'conn-alpha'
    );

    await service.getInventory('product-id', 'ol_variant_a', null);
    expect(inventoryRepository.findByProductAndVariant).toHaveBeenLastCalledWith(
      'product-id',
      'ol_variant_a',
      null,
      undefined
    );
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
