/**
 * Shipment Query Service unit tests (#846).
 *
 * Mocks `ShipmentRepositoryPort` and asserts the read seam delegates list /
 * by-id / active-by-order straight through. The service is intentionally a
 * pass-through (it exists to keep the controller off the repo port), so the
 * tests pin that contract rather than business logic.
 */

import { ShipmentQueryService } from './shipment-query.service';
import { Shipment } from '../../domain/entities/shipment.entity';
import type { ShipmentRepositoryPort } from '../../domain/ports/shipment-repository.port';
import type {
  PaginatedShipments,
  ShipmentFilters,
  ShipmentPagination,
} from '../../domain/types/shipment-query.types';

function makeShipment(overrides: Partial<Shipment> = {}): Shipment {
  return new Shipment(
    overrides.id ?? 'ol_shipment_1',
    overrides.orderId ?? 'ol_order_1',
    overrides.connectionId ?? 'conn-inpost',
    overrides.shippingMethod ?? 'paczkomat',
    overrides.status ?? 'generated',
    overrides.providerShipmentId ?? 'shipx-1',
    overrides.paczkomatId ?? 'POZ08A',
    overrides.trackingNumber ?? '6800000001',
    overrides.labelPdfRef ?? 'shipx:label:1',
    null,
    null,
    null,
    null,
    null,
    new Date(),
    new Date(),
  );
}

describe('ShipmentQueryService', () => {
  let repository: jest.Mocked<ShipmentRepositoryPort>;
  let service: ShipmentQueryService;

  beforeEach(() => {
    repository = {
      create: jest.fn(),
      findMany: jest.fn(),
      findById: jest.fn(),
      findByOrderId: jest.fn(),
      findActiveByOrderId: jest.fn(),
      findByProviderShipmentId: jest.fn(),
      update: jest.fn(),
    };
    service = new ShipmentQueryService(repository);
  });

  describe('list', () => {
    it('should delegate filters + pagination to the repository and return the page', async () => {
      const filters: ShipmentFilters = { status: 'generated', hasTracking: true };
      const pagination: ShipmentPagination = { limit: 20, offset: 0 };
      const page: PaginatedShipments = { items: [makeShipment()], total: 1 };
      repository.findMany.mockResolvedValue(page);

      const result = await service.list(filters, pagination);

      expect(repository.findMany).toHaveBeenCalledWith(filters, pagination);
      expect(result).toBe(page);
    });
  });

  describe('getById', () => {
    it('should return the shipment when found', async () => {
      const shipment = makeShipment();
      repository.findById.mockResolvedValue(shipment);

      await expect(service.getById('ol_shipment_1')).resolves.toBe(shipment);
      expect(repository.findById).toHaveBeenCalledWith('ol_shipment_1');
    });

    it('should return null when not found', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.getById('missing')).resolves.toBeNull();
    });
  });

  describe('getActiveByOrderId', () => {
    it('should delegate to the repository active-by-order lookup', async () => {
      const shipment = makeShipment();
      repository.findActiveByOrderId.mockResolvedValue(shipment);

      await expect(service.getActiveByOrderId('ol_order_1')).resolves.toBe(shipment);
      expect(repository.findActiveByOrderId).toHaveBeenCalledWith('ol_order_1');
    });
  });
});
