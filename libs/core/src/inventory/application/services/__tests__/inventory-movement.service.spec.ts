/**
 * Inventory Movement Service Unit Tests (#3565, #4062)
 *
 * The service is a thin read seam; these pin that it forwards filters and
 * pagination untouched, prunes both the ledger and the channel push record,
 * and finds a movement's pushes by the observation the movement recorded.
 *
 * @module libs/core/src/inventory/application/services/__tests__
 */
import { InventoryMovementService } from '../inventory-movement.service';
import type { InventoryMovementRepositoryPort } from '../../../domain/ports/inventory-movement-repository.port';
import type { ChannelQuantityPushRepositoryPort } from '../../../domain/ports/channel-quantity-push-repository.port';
import type { InventoryMovement } from '../../../domain/entities/inventory-movement.entity';

describe('InventoryMovementService', () => {
  let repository: jest.Mocked<InventoryMovementRepositoryPort>;
  let pushes: jest.Mocked<ChannelQuantityPushRepositoryPort>;
  let service: InventoryMovementService;

  beforeEach(() => {
    repository = {
      listHistory: jest.fn().mockResolvedValue([]),
      countHistory: jest.fn().mockResolvedValue(7),
      pruneOlderThan: jest.fn().mockResolvedValue(3),
      findById: jest.fn(),
    } as unknown as jest.Mocked<InventoryMovementRepositoryPort>;
    pushes = {
      appendMany: jest.fn(),
      findForObservation: jest.fn().mockResolvedValue([]),
      findLatestByVariantIds: jest.fn().mockResolvedValue([]),
      pruneOlderThan: jest.fn().mockResolvedValue(2),
    } as unknown as jest.Mocked<ChannelQuantityPushRepositoryPort>;
    service = new InventoryMovementService(repository, pushes);
  });

  it('should forward the filters and pagination when listing', async () => {
    const filters = { productVariantId: 'v1', kind: 'promised' as const };

    await service.listMovements(filters, { limit: 10, offset: 20 });

    expect(repository.listHistory).toHaveBeenCalledWith(filters, { limit: 10, offset: 20 });
  });

  it('should count with the same filters and no pagination', async () => {
    const filters = { needsAttention: true };

    await expect(service.countMovements(filters)).resolves.toBe(7);

    expect(repository.countHistory).toHaveBeenCalledWith(filters);
  });

  it('should prune the ledger and the push record and report both counts', async () => {
    const cutoff = new Date('2026-01-01T00:00:00Z');

    await expect(service.pruneOlderThan(cutoff, 500)).resolves.toBe(5);

    expect(repository.pruneOlderThan).toHaveBeenCalledWith(cutoff, 500);
    expect(pushes.pruneOlderThan).toHaveBeenCalledWith(cutoff, 500);
  });

  describe('listChannelPushes', () => {
    it('should read the pushes for the movement variant and its own observation', async () => {
      const occurredAt = new Date('2026-11-09T10:15:00.000Z');
      repository.findById.mockResolvedValue({
        productVariantId: 'v1',
        occurredAt,
      } as unknown as InventoryMovement);

      await expect(service.listChannelPushes('m1')).resolves.toEqual([]);

      expect(pushes.findForObservation).toHaveBeenCalledWith('v1', occurredAt);
    });

    it('should answer null when the movement does not exist', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.listChannelPushes('missing')).resolves.toBeNull();
      expect(pushes.findForObservation).not.toHaveBeenCalled();
    });

    it('should answer an empty list for a movement with no variant', async () => {
      repository.findById.mockResolvedValue({
        productVariantId: null,
        occurredAt: new Date(),
      } as unknown as InventoryMovement);

      await expect(service.listChannelPushes('m2')).resolves.toEqual([]);
      expect(pushes.findForObservation).not.toHaveBeenCalled();
    });
  });

  it('should read the last push per variant and connection', async () => {
    await service.getLastChannelPushes(['v1', 'v2']);

    expect(pushes.findLatestByVariantIds).toHaveBeenCalledWith(['v1', 'v2']);
  });
});
