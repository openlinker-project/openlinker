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
    overrides.sourceDeliveryMethodId ?? null,
    overrides.carrier ?? null,
    overrides.deliveryIntent ?? null,
    overrides.providerCode ?? null,
    overrides.waybillRelayedAt ?? null,
    overrides.direction ?? 'outbound',
    overrides.reservationConsumedAt ?? null,
    overrides.fulfillmentWorkId ?? null,
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
      findBranchOneByOrderAndConnection: jest.fn(),
      update: jest.fn(),
      claimWaybillRelay: jest.fn(),
      releaseWaybillRelay: jest.fn(),
      listDispatchedAwaitingReservationConsume: jest.fn(),
      claimReservationConsume: jest.fn(),
      claimFulfillmentWorkLink: jest.fn(),
      findByFulfillmentWorkIds: jest.fn(),
    };
    service = new ShipmentQueryService(repository);
  });

  describe('findByFulfillmentWorkIds', () => {
    it('should ask the repository once for the whole page, never per work', async () => {
      // The `getEarliestOrderDateByConnection` (#2083) N+1 precedent: batched
      // BEFORE any loop, so a page of 100 works is one query and not 100.
      repository.findByFulfillmentWorkIds.mockResolvedValue([]);

      await service.findByFulfillmentWorkIds(['w1', 'w2', 'w3'], 'outbound');

      expect(repository.findByFulfillmentWorkIds).toHaveBeenCalledTimes(1);
      expect(repository.findByFulfillmentWorkIds).toHaveBeenCalledWith(
        ['w1', 'w2', 'w3'],
        'outbound',
      );
    });

    it('should omit a work with no shipment rather than key it to an empty array', async () => {
      // The `listActiveHoldsForWorks` convention — absence means "no outbound
      // parcel", so a caller defaults with `?? []`.
      repository.findByFulfillmentWorkIds.mockResolvedValue([
        makeShipment({ id: 'ol_shipment_1', fulfillmentWorkId: 'w1' }),
      ]);

      const byWork = await service.findByFulfillmentWorkIds(['w1', 'w2'], 'outbound');

      expect(byWork.has('w2')).toBe(false);
      expect([...byWork.keys()]).toEqual(['w1']);
    });

    it('should bucket several shipments for one work under that work id', async () => {
      // A cancel + re-issue leaves two rows on one work; neither may be lost.
      repository.findByFulfillmentWorkIds.mockResolvedValue([
        makeShipment({ id: 'ol_shipment_1', fulfillmentWorkId: 'w1' }),
        makeShipment({ id: 'ol_shipment_2', fulfillmentWorkId: 'w1' }),
        makeShipment({ id: 'ol_shipment_3', fulfillmentWorkId: 'w2' }),
      ]);

      const byWork = await service.findByFulfillmentWorkIds(['w1', 'w2'], 'outbound');

      expect(byWork.get('w1')?.map((shipment) => shipment.id)).toEqual([
        'ol_shipment_1',
        'ol_shipment_2',
      ]);
      expect(byWork.get('w2')?.map((shipment) => shipment.id)).toEqual(['ol_shipment_3']);
    });
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
      // The cohort is stated explicitly (#2373) — the panel shows the order's
      // outbound shipment, never a return label.
      expect(repository.findActiveByOrderId).toHaveBeenCalledWith('ol_order_1', 'outbound');
    });
  });

  describe('hasConsumedReservations (#2348)', () => {
    it('should be false when the order has no shipments at all', async () => {
      repository.findByOrderId.mockResolvedValue([]);

      await expect(service.hasConsumedReservations('ol_order_1')).resolves.toBe(false);
    });

    it('should be false when no shipment has claimed the marker', async () => {
      repository.findByOrderId.mockResolvedValue([makeShipment({ reservationConsumedAt: null })]);

      await expect(service.hasConsumedReservations('ol_order_1')).resolves.toBe(false);
    });

    it('should be true when a shipment carries the marker', async () => {
      repository.findByOrderId.mockResolvedValue([
        makeShipment({ reservationConsumedAt: new Date('2026-05-21T16:00:00Z') }),
      ]);

      await expect(service.hasConsumedReservations('ol_order_1')).resolves.toBe(true);
    });

    it('should be true when ANY shipment carries the marker', async () => {
      // Partial dispatch is not modelled (`shipments` carries no line
      // composition), so the conservative reading — do not restore — is the one
      // that cannot oversell.
      repository.findByOrderId.mockResolvedValue([
        makeShipment({ id: 'ol_shipment_1', reservationConsumedAt: null }),
        makeShipment({
          id: 'ol_shipment_2',
          reservationConsumedAt: new Date('2026-05-21T16:00:00Z'),
        }),
      ]);

      await expect(service.hasConsumedReservations('ol_order_1')).resolves.toBe(true);
    });
  });
});
