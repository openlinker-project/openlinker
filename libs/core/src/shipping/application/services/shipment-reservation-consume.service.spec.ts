/**
 * Shipment Reservation Consume Service — unit tests (#2347)
 *
 * The subject is a concurrency contract whose failure modes are (a) stock that
 * is never released and (b) stock released twice, so the tests are written
 * against the ORDERING and the counters rather than against internals.
 *
 * The consume-then-claim ordering in particular is asserted explicitly: it is
 * the crash-safety property, and it looks like an arbitrary sequencing choice to
 * anyone who has not read why, so it needs a test that fails if someone "tidies"
 * it back to claim-first.
 *
 * @module libs/core/src/shipping/application/services
 */
import type { IReservationService } from '@openlinker/core/inventory';

import { ShipmentReservationConsumeService } from './shipment-reservation-consume.service';
import { Shipment } from '../../domain/entities/shipment.entity';
import type { ShipmentRepositoryPort } from '../../domain/ports/shipment-repository.port';
import type { ShipmentStatus } from '../../domain/types/shipment-status.types';

const NOW = new Date('2026-08-26T10:00:00.000Z');

function shipment(id: string, orderId: string, status: ShipmentStatus = 'dispatched'): Shipment {
  return new Shipment(
    id,
    orderId,
    '00000000-0000-0000-0000-000000000001',
    'paczkomat',
    status,
    null,
    null,
    null,
    null,
    NOW,
    null,
    null,
    null,
    null,
    NOW,
    NOW,
    null,
    null,
    null,
    null,
    null,
    null,
  );
}

describe('ShipmentReservationConsumeService', () => {
  let shipments: jest.Mocked<ShipmentRepositoryPort>;
  let reservations: jest.Mocked<IReservationService>;
  let service: ShipmentReservationConsumeService;

  beforeEach(() => {
    shipments = {
      listDispatchedAwaitingReservationConsume: jest.fn().mockResolvedValue([]),
      claimReservationConsume: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<ShipmentRepositoryPort>;

    reservations = {
      reserveForOrder: jest.fn(),
      closeForOrder: jest
        .fn()
        .mockResolvedValue({ closed: 2, alreadyTerminal: 0, failed: 0 }),
    } as unknown as jest.Mocked<IReservationService>;

    service = new ShipmentReservationConsumeService(shipments, reservations);
  });

  it('should consume BEFORE claiming the marker', async () => {
    // The crash-safety property, and the whole reason this ordering exists.
    // Claim-first would mean a process kill between the two leaves the marker
    // set, the shipment permanently out of the candidate set, and its
    // reservations held forever — with no catch able to compensate, because a
    // kill runs no code.
    const calls: string[] = [];
    reservations.closeForOrder.mockImplementation(() => {
      calls.push('consume');
      return Promise.resolve({ closed: 1, alreadyTerminal: 0, failed: 0 });
    });
    shipments.claimReservationConsume.mockImplementation(() => {
      calls.push('claim');
      return Promise.resolve(true);
    });
    shipments.listDispatchedAwaitingReservationConsume.mockResolvedValue([
      shipment('ol_shipment_1', 'ol_order_1'),
    ]);

    await service.consumeDueShipments({ limit: 10, now: NOW });

    expect(calls).toEqual(['consume', 'claim']);
  });

  it('should claim the marker with the run instant once the order is fully closed', async () => {
    shipments.listDispatchedAwaitingReservationConsume.mockResolvedValue([
      shipment('ol_shipment_1', 'ol_order_1'),
    ]);

    const result = await service.consumeDueShipments({ limit: 10, now: NOW });

    expect(reservations.closeForOrder).toHaveBeenCalledWith({
      orderRecordId: 'ol_order_1',
      // The terminal status is data (§ 6I), so this pass must NAME the one it
      // means. A shipment consume that passed 'released' would decrement the
      // same counter while recording the wrong reason for it forever.
      terminalStatus: 'consumed',
    });
    expect(shipments.claimReservationConsume).toHaveBeenCalledWith('ol_shipment_1', NOW);
    expect(result).toEqual({
      examined: 1,
      consumed: 1,
      reservationsConsumed: 2,
      alreadyTerminal: 0,
      skipped: 0,
      failed: 0,
    });
  });

  it('should NOT claim the marker when any reservation row failed to close', async () => {
    // Claiming here would retire the shipment from the candidate set with live
    // holds still standing — precisely the leak this pass exists to prevent.
    // Leaving the marker NULL is what makes the next tick retry.
    shipments.listDispatchedAwaitingReservationConsume.mockResolvedValue([
      shipment('ol_shipment_1', 'ol_order_1'),
    ]);
    reservations.closeForOrder.mockResolvedValue({
      closed: 1,
      alreadyTerminal: 0,
      failed: 1,
    });

    const result = await service.consumeDueShipments({ limit: 10, now: NOW });

    expect(shipments.claimReservationConsume).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
    expect(result.consumed).toBe(0);
  });

  it('should leave the marker unclaimed when the consume throws, so the next tick retries', async () => {
    shipments.listDispatchedAwaitingReservationConsume.mockResolvedValue([
      shipment('ol_shipment_1', 'ol_order_1'),
    ]);
    reservations.closeForOrder.mockRejectedValue(new Error('ledger unavailable'));

    const result = await service.consumeDueShipments({ limit: 10, now: NOW });

    expect(shipments.claimReservationConsume).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
  });

  it('should count a lost claim as skipped, not as an error', async () => {
    // A peer marked it between our read and our write. Its consume did the same
    // work ours did; the ledger's own guard means nothing double-decremented.
    shipments.listDispatchedAwaitingReservationConsume.mockResolvedValue([
      shipment('ol_shipment_1', 'ol_order_1'),
    ]);
    shipments.claimReservationConsume.mockResolvedValue(false);

    const result = await service.consumeDueShipments({ limit: 10, now: NOW });

    expect(result.skipped).toBe(1);
    expect(result.consumed).toBe(0);
    expect(result.failed).toBe(0);
  });

  it('should continue past a failing candidate and still consume the rest of the page', async () => {
    shipments.listDispatchedAwaitingReservationConsume.mockResolvedValue([
      shipment('ol_shipment_1', 'ol_order_1'),
      shipment('ol_shipment_2', 'ol_order_2'),
    ]);
    reservations.closeForOrder
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ closed: 3, alreadyTerminal: 1, failed: 0 });

    const result = await service.consumeDueShipments({ limit: 10, now: NOW });

    expect(result).toEqual({
      examined: 2,
      consumed: 1,
      reservationsConsumed: 3,
      alreadyTerminal: 1,
      skipped: 0,
      failed: 1,
    });
    expect(shipments.claimReservationConsume).toHaveBeenCalledTimes(1);
    expect(shipments.claimReservationConsume).toHaveBeenCalledWith('ol_shipment_2', NOW);
  });

  it('should report an all-zero result and touch nothing when no candidate exists', async () => {
    const result = await service.consumeDueShipments({ limit: 10, now: NOW });

    expect(result.examined).toBe(0);
    expect(reservations.closeForOrder).not.toHaveBeenCalled();
    expect(shipments.claimReservationConsume).not.toHaveBeenCalled();
  });

  it('should pass the budget through to the candidate read', async () => {
    await service.consumeDueShipments({ limit: 42, now: NOW });

    expect(shipments.listDispatchedAwaitingReservationConsume).toHaveBeenCalledWith(42);
  });
});
