/**
 * Inventory Movement Service Unit Tests (#3565)
 *
 * The service is a thin read seam; these pin that it forwards filters and
 * pagination untouched and exposes the prune the retention sweep uses.
 *
 * @module libs/core/src/inventory/application/services/__tests__
 */
import { InventoryMovementService } from '../inventory-movement.service';
import type { InventoryMovementRepositoryPort } from '../../../domain/ports/inventory-movement-repository.port';

describe('InventoryMovementService', () => {
  let repository: jest.Mocked<InventoryMovementRepositoryPort>;
  let service: InventoryMovementService;

  beforeEach(() => {
    repository = {
      listHistory: jest.fn().mockResolvedValue([]),
      countHistory: jest.fn().mockResolvedValue(7),
      pruneOlderThan: jest.fn().mockResolvedValue(3),
    } as unknown as jest.Mocked<InventoryMovementRepositoryPort>;
    service = new InventoryMovementService(repository);
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

  it('should delegate the retention prune to the repository', async () => {
    const cutoff = new Date('2026-01-01T00:00:00Z');

    await expect(service.pruneOlderThan(cutoff, 500)).resolves.toBe(3);

    expect(repository.pruneOlderThan).toHaveBeenCalledWith(cutoff, 500);
  });
});
