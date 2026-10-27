/**
 * Master-Absorbed Reservation Service - unit tests
 *
 * Each case pins one rule about WHICH hold a destination master may consume.
 * Getting one wrong is never an error: consuming too much publishes units that
 * are already promised, consuming too little subtracts a sale twice. So the
 * assertions are on what reaches `closeForOrder` and what does not.
 *
 * @module libs/core/src/inventory/application/services
 */
import type { SyncJobQueuePort } from '@openlinker/core/sync';

import { MasterAbsorbedReservationService } from '../master-absorbed-reservation.service';
import type { IReservationService } from '../reservation.service.interface';
import type { ReservationRepositoryPort } from '../../../domain/ports/reservation-repository.port';
import type { InventoryRepositoryPort } from '../../../domain/ports/inventory-repository.port';
import { Reservation } from '../../../domain/entities/reservation.entity';
import type { InventoryOwnerPosition } from '../../../domain/types/inventory.types';
import type { ConsumeAbsorbedHoldsInput } from '../master-absorbed-reservation.service.interface';

const ORDER_ID = 'ol_order_1';
const SHOP = 'conn-shop';
const OTHER_MASTER = 'conn-other-master';
const NOW = new Date('2026-10-26T10:00:00.000Z');

function hold(overrides: Partial<Reservation> = {}): Reservation {
  return new Reservation(
    overrides.id ?? 'res-1',
    overrides.orderRecordId ?? ORDER_ID,
    overrides.orderLineId ?? 'line-1',
    overrides.inventoryItemId ?? 'inv-1',
    overrides.quantity ?? 1,
    overrides.status ?? 'held',
    overrides.expiresAt ?? NOW,
    overrides.atpEffect ?? 'published',
    overrides.createdAt ?? NOW,
    overrides.updatedAt ?? NOW,
    overrides.closedAt ?? null
  );
}

function position(overrides: Partial<InventoryOwnerPosition> = {}): InventoryOwnerPosition {
  return {
    inventoryItemId: 'inv-1',
    productId: 'ol_product_1',
    productVariantId: 'ol_variant_1',
    locationId: null,
    sourceConnectionId: SHOP,
    availableQuantity: 21,
    reservedQuantity: 0,
    ...overrides,
  };
}

function input(overrides: Partial<ConsumeAbsorbedHoldsInput> = {}): ConsumeAbsorbedHoldsInput {
  return {
    orderRecordId: ORDER_ID,
    masterConnectionId: SHOP,
    productIds: ['ol_product_1'],
    propagate: false,
    ...overrides,
  };
}

describe('MasterAbsorbedReservationService', () => {
  let reservationRepository: jest.Mocked<
    Pick<ReservationRepositoryPort, 'listHeldByOrderRecordId'>
  >;
  let inventoryRepository: jest.Mocked<Pick<InventoryRepositoryPort, 'findLiveOwnerPositions'>>;
  let reservations: jest.Mocked<Pick<IReservationService, 'closeForOrder'>>;
  let jobQueue: jest.Mocked<Pick<SyncJobQueuePort, 'enqueue'>>;
  let service: MasterAbsorbedReservationService;

  beforeEach(() => {
    reservationRepository = { listHeldByOrderRecordId: jest.fn().mockResolvedValue([hold()]) };
    inventoryRepository = { findLiveOwnerPositions: jest.fn().mockResolvedValue([position()]) };
    reservations = {
      closeForOrder: jest.fn().mockResolvedValue({ closed: 1, alreadyTerminal: 0, failed: 0 }),
    };
    jobQueue = { enqueue: jest.fn().mockResolvedValue('job-1') };

    service = new MasterAbsorbedReservationService(
      reservationRepository as unknown as ReservationRepositoryPort,
      inventoryRepository as unknown as InventoryRepositoryPort,
      reservations as unknown as IReservationService,
      jobQueue as unknown as SyncJobQueuePort
    );
  });

  it('should consume the hold when its position is owned by the destination', async () => {
    const result = await service.consumeAbsorbedHolds(input());

    expect(reservations.closeForOrder).toHaveBeenCalledWith({
      orderRecordId: ORDER_ID,
      // `consumed`, not `released`: the order was not cancelled, the master
      // now carries the sale (the #3480 meaning of the status).
      terminalStatus: 'consumed',
      orderLineIds: ['line-1'],
    });
    expect(result).toMatchObject({ closed: 1, keptOtherOwner: 0, keptUnattributed: 0 });
  });

  it('should keep the hold when its position is owned by a different master', async () => {
    // That master never received this order, so its stock has not moved and
    // the hold is still the only thing reducing what is promised.
    inventoryRepository.findLiveOwnerPositions.mockResolvedValue([
      position({ sourceConnectionId: OTHER_MASTER }),
    ]);

    const result = await service.consumeAbsorbedHolds(input());

    expect(reservations.closeForOrder).not.toHaveBeenCalled();
    expect(result).toMatchObject({ closed: 0, keptOtherOwner: 1 });
  });

  it.each([
    ['NULL', null],
    ["'legacy'", 'legacy'],
  ])('should keep the hold when its position provenance is %s', async (_label, owner) => {
    // An unnamed owner may be a master that did NOT decrement; closing would
    // publish promised units. Keeping it only under-sells until dispatch.
    inventoryRepository.findLiveOwnerPositions.mockResolvedValue([
      position({ sourceConnectionId: owner }),
    ]);

    const result = await service.consumeAbsorbedHolds(input());

    expect(reservations.closeForOrder).not.toHaveBeenCalled();
    expect(result).toMatchObject({ closed: 0, keptUnattributed: 1 });
  });

  it('should keep a diagnostic hold, which subtracts nothing', async () => {
    reservationRepository.listHeldByOrderRecordId.mockResolvedValue([
      hold({ atpEffect: 'diagnostic' }),
    ]);

    const result = await service.consumeAbsorbedHolds(input());

    expect(reservations.closeForOrder).not.toHaveBeenCalled();
    expect(result).toMatchObject({ keptDiagnostic: 1 });
  });

  it('should keep a hold whose position is no longer live', async () => {
    inventoryRepository.findLiveOwnerPositions.mockResolvedValue([]);

    const result = await service.consumeAbsorbedHolds(input());

    expect(reservations.closeForOrder).not.toHaveBeenCalled();
    expect(result).toMatchObject({ keptUnknownPosition: 1 });
  });

  it('should close only the lines on the destination in a mixed basket', async () => {
    reservationRepository.listHeldByOrderRecordId.mockResolvedValue([
      hold({ id: 'res-1', orderLineId: 'line-1', inventoryItemId: 'inv-1' }),
      hold({ id: 'res-2', orderLineId: 'line-2', inventoryItemId: 'inv-2' }),
    ]);
    inventoryRepository.findLiveOwnerPositions.mockResolvedValue([
      position({ inventoryItemId: 'inv-1' }),
      position({
        inventoryItemId: 'inv-2',
        productVariantId: 'ol_variant_2',
        sourceConnectionId: OTHER_MASTER,
      }),
    ]);

    const result = await service.consumeAbsorbedHolds(input());

    expect(reservations.closeForOrder).toHaveBeenCalledWith(
      expect.objectContaining({ orderLineIds: ['line-1'] })
    );
    expect(result).toMatchObject({ closed: 1, keptOtherOwner: 1 });
  });

  it('should keep a line whose holds span this master and another one', async () => {
    // The close is line-scoped, so closing this master's hold would also close
    // the other master's - which must stay.
    reservationRepository.listHeldByOrderRecordId.mockResolvedValue([
      hold({ id: 'res-1', inventoryItemId: 'inv-1' }),
      hold({ id: 'res-2', inventoryItemId: 'inv-2' }),
    ]);
    inventoryRepository.findLiveOwnerPositions.mockResolvedValue([
      position({ inventoryItemId: 'inv-1' }),
      position({ inventoryItemId: 'inv-2', sourceConnectionId: OTHER_MASTER }),
    ]);

    const result = await service.consumeAbsorbedHolds(input());

    expect(reservations.closeForOrder).not.toHaveBeenCalled();
    expect(result).toMatchObject({ keptSharedLine: 1, keptOtherOwner: 1 });
  });

  it('should do nothing on a re-run once the hold is consumed', async () => {
    // The re-poll case: the hold left `held`, so there is nothing to read
    // positions for, nothing to close and nothing to republish.
    reservationRepository.listHeldByOrderRecordId.mockResolvedValue([]);

    const result = await service.consumeAbsorbedHolds(input({ propagate: true }));

    expect(inventoryRepository.findLiveOwnerPositions).not.toHaveBeenCalled();
    expect(reservations.closeForOrder).not.toHaveBeenCalled();
    expect(jobQueue.enqueue).not.toHaveBeenCalled();
    expect(result.closed).toBe(0);
  });

  describe('propagation', () => {
    it('should enqueue one propagation per variant, scoped to the master, when asked', async () => {
      // Two lines on one variant must republish once: the handler reads the
      // whole variant aggregate.
      reservationRepository.listHeldByOrderRecordId.mockResolvedValue([
        hold({ id: 'res-1', orderLineId: 'line-1', inventoryItemId: 'inv-1' }),
        hold({ id: 'res-2', orderLineId: 'line-2', inventoryItemId: 'inv-1' }),
      ]);
      reservations.closeForOrder.mockResolvedValue({ closed: 2, alreadyTerminal: 0, failed: 0 });

      const result = await service.consumeAbsorbedHolds(input({ propagate: true }));

      expect(jobQueue.enqueue).toHaveBeenCalledTimes(1);
      const [request] = jobQueue.enqueue.mock.calls[0];
      expect(request).toMatchObject({
        type: 'inventory.propagateToMarketplaces',
        connectionId: SHOP,
        payload: { productId: 'ol_product_1', variantId: 'ol_variant_1' },
      });
      expect(request.options.dedupeKey).toMatch(
        /^inventory:propagate:ol_product_1:ol_variant_1:\d{4}-/
      );
      expect(result.propagationsEnqueued).toBe(1);
    });

    it('should not enqueue when the caller did not ask', async () => {
      // A fresh create: the post-sale re-read republishes with the master's
      // lowered number, so a propagation here could only publish a stale one.
      await service.consumeAbsorbedHolds(input({ propagate: false }));

      expect(jobQueue.enqueue).not.toHaveBeenCalled();
    });

    it('should not enqueue when a peer already closed the hold', async () => {
      reservations.closeForOrder.mockResolvedValue({ closed: 0, alreadyTerminal: 1, failed: 0 });

      const result = await service.consumeAbsorbedHolds(input({ propagate: true }));

      expect(jobQueue.enqueue).not.toHaveBeenCalled();
      expect(result).toMatchObject({ closed: 0, alreadyTerminal: 1 });
    });

    it('should report a failed enqueue rather than throw, since the close is durable', async () => {
      jobQueue.enqueue.mockRejectedValue(new Error('queue unavailable'));

      const result = await service.consumeAbsorbedHolds(input({ propagate: true }));

      expect(result).toMatchObject({ closed: 1, propagationsEnqueued: 0 });
    });
  });
});
