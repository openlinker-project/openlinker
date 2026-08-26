/**
 * Reservation Service — unit tests (#2344)
 *
 * Every assertion here is about a rule whose failure mode is an oversell rather
 * than an error, so the tests are written against the CONTRACT (what reaches
 * `claimHeld`, and what deliberately does not) rather than against internals.
 *
 * @module libs/core/src/inventory/application/services
 */
import { ReservationService } from '../reservation.service';
import type { ReservationRepositoryPort } from '../../../domain/ports/reservation-repository.port';
import type { InventoryRepositoryPort } from '../../../domain/ports/inventory-repository.port';
import type { InventoryPositionCandidate } from '../../../domain/types/inventory.types';
import type { ReservationClaimOutcome } from '../../../domain/types/reservation.types';
import { Reservation } from '../../../domain/entities/reservation.entity';
import { AmbiguousReservationPositionError } from '../../../domain/exceptions/ambiguous-reservation-position.error';
import { InsufficientAvailabilityError } from '../../../domain/exceptions/insufficient-availability.error';
import { ReservationNotHeldError } from '../../../domain/exceptions/reservation-not-held.error';
import { RESERVATION_TTL_MS_DEFAULT } from '../../../domain/types/reservation-expiry.types';
import type { ReserveOrderLineInput } from '../../types/reservation-service.types';

const ORDER_ID = 'ol_order_1';
const NOW = new Date('2026-08-26T10:00:00.000Z');

function position(
  overrides: Partial<InventoryPositionCandidate> = {}
): InventoryPositionCandidate {
  return {
    productId: 'ol_product_1',
    productVariantId: 'ol_variant_1',
    inventoryItemId: 'inv-1',
    locationId: null,
    ...overrides,
  };
}

function line(overrides: Partial<ReserveOrderLineInput> = {}): ReserveOrderLineInput {
  return {
    orderLineId: 'line-1',
    productId: 'ol_product_1',
    productVariantId: 'ol_variant_1',
    quantity: 2,
    ...overrides,
  };
}

function reservation(overrides: Partial<Reservation> = {}): Reservation {
  return new Reservation(
    overrides.id ?? 'res-1',
    overrides.orderRecordId ?? ORDER_ID,
    overrides.orderLineId ?? 'line-1',
    overrides.inventoryItemId ?? 'inv-1',
    overrides.quantity ?? 2,
    overrides.status ?? 'held',
    overrides.expiresAt ?? NOW,
    overrides.atpEffect ?? 'published',
    overrides.createdAt ?? NOW,
    overrides.updatedAt ?? NOW,
    overrides.closedAt ?? null
  );
}

function outcome(overrides: Partial<ReservationClaimOutcome> = {}): ReservationClaimOutcome {
  return {
    reservation: reservation(),
    previousQuantity: 0,
    deltaApplied: 2,
    remainingAtp: 8,
    ...overrides,
  };
}

describe('ReservationService', () => {
  let reservations: jest.Mocked<ReservationRepositoryPort>;
  let inventory: jest.Mocked<Pick<InventoryRepositoryPort, 'findLivePositionsByProductIds'>>;
  let service: ReservationService;

  beforeEach(() => {
    reservations = {
      claimHeld: jest.fn().mockResolvedValue([outcome()]),
      releaseHeld: jest.fn(),
      findHeld: jest.fn(),
      listHeldByOrderRecordId: jest.fn(),
      listByOrderRecordId: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<ReservationRepositoryPort>;

    inventory = {
      findLivePositionsByProductIds: jest.fn().mockResolvedValue([position()]),
    };

    service = new ReservationService(
      reservations,
      inventory as unknown as InventoryRepositoryPort
    );
  });

  describe('reserveForOrder', () => {
    it('should claim every line in a single call when several lines resolve', async () => {
      // The one-call rule IS the deadlock guarantee, the transaction and the
      // all-or-nothing rollback — a per-line loop forfeits all three.
      inventory.findLivePositionsByProductIds.mockResolvedValue([
        position({ productVariantId: 'ol_variant_1', inventoryItemId: 'inv-1' }),
        position({ productVariantId: 'ol_variant_2', inventoryItemId: 'inv-2' }),
      ]);

      await service.reserveForOrder({
        orderRecordId: ORDER_ID,
        atpEffect: 'published',
        now: NOW,
        lines: [
          line({ orderLineId: 'line-1', productVariantId: 'ol_variant_1' }),
          line({ orderLineId: 'line-2', productVariantId: 'ol_variant_2' }),
        ],
      });

      expect(reservations.claimHeld).toHaveBeenCalledTimes(1);
      expect(reservations.claimHeld.mock.calls[0][0]).toHaveLength(2);
    });

    it('should forward atpEffect verbatim and never substitute a default', async () => {
      await service.reserveForOrder({
        orderRecordId: ORDER_ID,
        atpEffect: 'diagnostic',
        now: NOW,
        lines: [line()],
      });

      expect(reservations.claimHeld.mock.calls[0][0][0].atpEffect).toBe('diagnostic');
    });

    it('should pass the desired total quantity, never a delta', async () => {
      await service.reserveForOrder({
        orderRecordId: ORDER_ID,
        atpEffect: 'published',
        now: NOW,
        lines: [line({ quantity: 5 })],
      });

      expect(reservations.claimHeld.mock.calls[0][0][0].quantity).toBe(5);
    });

    it('should report a repeated identical claim as granted with no delta applied', async () => {
      // Get-or-create: the repository reports a conflict as a SUCCESS, which is
      // what makes an ingestion crash after the claim resumable.
      reservations.claimHeld.mockResolvedValue([
        outcome({ previousQuantity: 2, deltaApplied: 0, remainingAtp: null }),
      ]);

      const result = await service.reserveForOrder({
        orderRecordId: ORDER_ID,
        atpEffect: 'published',
        now: NOW,
        lines: [line()],
      });

      expect(result.granted[0].deltaApplied).toBe(0);
      expect(result.skipped).toEqual([]);
    });

    it('should never read the ledger to size a claim', async () => {
      // The check IS the reserve. A pre-read of held quantity would be the
      // unlocked read-then-act whose failure mode is an oversell.
      await service.reserveForOrder({
        orderRecordId: ORDER_ID,
        atpEffect: 'published',
        now: NOW,
        lines: [line()],
      });

      expect(reservations.findHeld).not.toHaveBeenCalled();
      expect(reservations.listHeldByOrderRecordId).not.toHaveBeenCalled();
    });

    it('should default expiresAt to now plus the configured ttl', async () => {
      await service.reserveForOrder({
        orderRecordId: ORDER_ID,
        atpEffect: 'published',
        now: NOW,
        lines: [line()],
      });

      expect(reservations.claimHeld.mock.calls[0][0][0].expiresAt.getTime()).toBe(
        NOW.getTime() + RESERVATION_TTL_MS_DEFAULT
      );
    });

    it('should honour a caller-supplied expiresAt', async () => {
      const expiresAt = new Date('2026-09-01T00:00:00.000Z');

      await service.reserveForOrder({
        orderRecordId: ORDER_ID,
        atpEffect: 'published',
        now: NOW,
        expiresAt,
        lines: [line()],
      });

      expect(reservations.claimHeld.mock.calls[0][0][0].expiresAt).toBe(expiresAt);
    });

    it('should propagate InsufficientAvailabilityError from the guarded claim', async () => {
      reservations.claimHeld.mockRejectedValue(new InsufficientAvailabilityError('inv-1', 5, 2));

      await expect(
        service.reserveForOrder({
          orderRecordId: ORDER_ID,
          atpEffect: 'published',
          now: NOW,
          lines: [line({ quantity: 5 })],
        })
      ).rejects.toBeInstanceOf(InsufficientAvailabilityError);
    });

    it('should reject a non-positive quantity before any storage access', async () => {
      await expect(
        service.reserveForOrder({
          orderRecordId: ORDER_ID,
          atpEffect: 'published',
          now: NOW,
          lines: [line({ quantity: 0 })],
        })
      ).rejects.toBeInstanceOf(RangeError);

      expect(inventory.findLivePositionsByProductIds).not.toHaveBeenCalled();
      expect(reservations.claimHeld).not.toHaveBeenCalled();
    });

    it('should reject a fractional quantity before any storage access', async () => {
      await expect(
        service.reserveForOrder({
          orderRecordId: ORDER_ID,
          atpEffect: 'published',
          now: NOW,
          lines: [line({ quantity: 1.5 })],
        })
      ).rejects.toBeInstanceOf(RangeError);

      expect(reservations.claimHeld).not.toHaveBeenCalled();
    });

    it('should return without touching storage when there are no lines', async () => {
      const result = await service.reserveForOrder({
        orderRecordId: ORDER_ID,
        atpEffect: 'published',
        now: NOW,
        lines: [],
      });

      expect(result).toEqual({ granted: [], skipped: [] });
      expect(reservations.listByOrderRecordId).not.toHaveBeenCalled();
      expect(reservations.claimHeld).not.toHaveBeenCalled();
    });
  });

  describe('the multi-position gate', () => {
    it('should raise AmbiguousReservationPositionError naming both positions', async () => {
      inventory.findLivePositionsByProductIds.mockResolvedValue([
        position({ inventoryItemId: 'inv-1' }),
        position({ inventoryItemId: 'inv-2' }),
      ]);

      const promise = service.reserveForOrder({
        orderRecordId: ORDER_ID,
        atpEffect: 'published',
        now: NOW,
        lines: [line()],
      });

      await expect(promise).rejects.toBeInstanceOf(AmbiguousReservationPositionError);
      await expect(promise).rejects.toThrow('inv-1');
      await expect(promise).rejects.toThrow('inv-2');
    });

    it('should write nothing when a line is ambiguous', async () => {
      inventory.findLivePositionsByProductIds.mockResolvedValue([
        position({ productVariantId: 'ol_variant_1', inventoryItemId: 'inv-1' }),
        position({ productVariantId: 'ol_variant_1', inventoryItemId: 'inv-2' }),
        position({ productVariantId: 'ol_variant_2', inventoryItemId: 'inv-3' }),
      ]);

      await expect(
        service.reserveForOrder({
          orderRecordId: ORDER_ID,
          atpEffect: 'published',
          now: NOW,
          lines: [
            line({ orderLineId: 'line-1', productVariantId: 'ol_variant_1' }),
            line({ orderLineId: 'line-2', productVariantId: 'ol_variant_2' }),
          ],
        })
      ).rejects.toBeInstanceOf(AmbiguousReservationPositionError);

      expect(reservations.claimHeld).not.toHaveBeenCalled();
    });

    it('should raise once, naming every ambiguous line, so one retry suffices', async () => {
      inventory.findLivePositionsByProductIds.mockResolvedValue([
        position({ productVariantId: 'ol_variant_1', inventoryItemId: 'inv-1' }),
        position({ productVariantId: 'ol_variant_1', inventoryItemId: 'inv-2' }),
        position({ productVariantId: 'ol_variant_2', inventoryItemId: 'inv-3' }),
        position({ productVariantId: 'ol_variant_2', inventoryItemId: 'inv-4' }),
      ]);

      await service
        .reserveForOrder({
          orderRecordId: ORDER_ID,
          atpEffect: 'published',
          now: NOW,
          lines: [
            line({ orderLineId: 'line-1', productVariantId: 'ol_variant_1' }),
            line({ orderLineId: 'line-2', productVariantId: 'ol_variant_2' }),
          ],
        })
        .catch((error: unknown) => {
          const ambiguous = error as AmbiguousReservationPositionError;
          expect(ambiguous.ambiguities.map((a) => a.orderLineId)).toEqual(['line-1', 'line-2']);
        });

      expect.assertions(1);
    });

    it('should use an explicit position and bypass the gate entirely', async () => {
      inventory.findLivePositionsByProductIds.mockResolvedValue([
        position({ inventoryItemId: 'inv-1' }),
        position({ inventoryItemId: 'inv-2' }),
      ]);

      await service.reserveForOrder({
        orderRecordId: ORDER_ID,
        atpEffect: 'published',
        now: NOW,
        lines: [line({ inventoryItemId: 'inv-2' })],
      });

      expect(reservations.claimHeld.mock.calls[0][0][0].inventoryItemId).toBe('inv-2');
    });

    it('should pass an explicit position through unvalidated', async () => {
      // The repository's guard discriminates missing vs stale accurately; a
      // membership test here would report a stale id as `missing`.
      inventory.findLivePositionsByProductIds.mockResolvedValue([]);

      await service.reserveForOrder({
        orderRecordId: ORDER_ID,
        atpEffect: 'published',
        now: NOW,
        lines: [line({ inventoryItemId: 'inv-stale' })],
      });

      expect(reservations.claimHeld.mock.calls[0][0][0].inventoryItemId).toBe('inv-stale');
    });

    it('should resolve a product-level line against the null-variant position', async () => {
      inventory.findLivePositionsByProductIds.mockResolvedValue([
        position({ productVariantId: null, inventoryItemId: 'inv-product' }),
      ]);

      await service.reserveForOrder({
        orderRecordId: ORDER_ID,
        atpEffect: 'published',
        now: NOW,
        lines: [line({ productVariantId: null })],
      });

      expect(reservations.claimHeld.mock.calls[0][0][0].inventoryItemId).toBe('inv-product');
    });
  });

  describe('lines that are correctly not held', () => {
    it('should skip a line with no live position rather than raising', async () => {
      inventory.findLivePositionsByProductIds.mockResolvedValue([]);

      const result = await service.reserveForOrder({
        orderRecordId: ORDER_ID,
        atpEffect: 'published',
        now: NOW,
        lines: [line()],
      });

      expect(result.skipped).toEqual([{ orderLineId: 'line-1', reason: 'no-position' }]);
      expect(reservations.claimHeld).not.toHaveBeenCalled();
    });

    it('should still claim the other lines when one has no position', async () => {
      inventory.findLivePositionsByProductIds.mockResolvedValue([
        position({ productVariantId: 'ol_variant_2', inventoryItemId: 'inv-2' }),
      ]);

      const result = await service.reserveForOrder({
        orderRecordId: ORDER_ID,
        atpEffect: 'published',
        now: NOW,
        lines: [
          line({ orderLineId: 'line-1', productVariantId: 'ol_variant_1' }),
          line({ orderLineId: 'line-2', productVariantId: 'ol_variant_2' }),
        ],
      });

      expect(result.skipped).toEqual([{ orderLineId: 'line-1', reason: 'no-position' }]);
      expect(reservations.claimHeld.mock.calls[0][0]).toHaveLength(1);
      expect(reservations.claimHeld.mock.calls[0][0][0].orderLineId).toBe('line-2');
    });

    it('should never re-hold a line whose reservation was already consumed', async () => {
      // The idempotency index is partial on `status = 'held'`, so a consumed row
      // does not block a fresh insert. Without this gate, every re-poll of a
      // shipped order would mint a new hold for stock that has already left.
      reservations.listByOrderRecordId.mockResolvedValue([
        reservation({ status: 'consumed', closedAt: NOW }),
      ]);

      const result = await service.reserveForOrder({
        orderRecordId: ORDER_ID,
        atpEffect: 'published',
        now: NOW,
        lines: [line()],
      });

      expect(result.skipped).toEqual([{ orderLineId: 'line-1', reason: 'already-closed' }]);
      expect(reservations.claimHeld).not.toHaveBeenCalled();
    });

    it.each(['released', 'expired'] as const)(
      'should never re-hold a line whose reservation was %s',
      async (status) => {
        reservations.listByOrderRecordId.mockResolvedValue([
          reservation({ status, closedAt: NOW }),
        ]);

        const result = await service.reserveForOrder({
          orderRecordId: ORDER_ID,
          atpEffect: 'published',
          now: NOW,
          lines: [line()],
        });

        expect(result.skipped).toEqual([{ orderLineId: 'line-1', reason: 'already-closed' }]);
      }
    );

    it('should still claim a line whose existing reservation is HELD', async () => {
      // A live hold is the get-or-create path, not a terminal one — it must
      // reach `claimHeld` so a replay stays idempotent and an amendment adjusts.
      reservations.listByOrderRecordId.mockResolvedValue([reservation({ status: 'held' })]);

      await service.reserveForOrder({
        orderRecordId: ORDER_ID,
        atpEffect: 'published',
        now: NOW,
        lines: [line()],
      });

      expect(reservations.claimHeld).toHaveBeenCalledTimes(1);
    });

    it('should keep a closed line closed even when it re-resolves to a different position', async () => {
      // The gate is keyed on the LINE, not on `(line, position)`. A line's
      // position is not stable across the ladder (#2320 / #2322), so a
      // position-scoped key would match nothing here and mint a fresh hold for
      // stock that has already shipped — the exact harm the gate prevents.
      reservations.listByOrderRecordId.mockResolvedValue([
        reservation({ status: 'consumed', inventoryItemId: 'inv-old' }),
      ]);
      inventory.findLivePositionsByProductIds.mockResolvedValue([
        position({ inventoryItemId: 'inv-new' }),
      ]);

      const result = await service.reserveForOrder({
        orderRecordId: ORDER_ID,
        atpEffect: 'published',
        now: NOW,
        lines: [line()],
      });

      expect(result.skipped).toEqual([{ orderLineId: 'line-1', reason: 'already-closed' }]);
      expect(reservations.claimHeld).not.toHaveBeenCalled();
    });

    it('should not let one closed line close a different line of the same order', async () => {
      reservations.listByOrderRecordId.mockResolvedValue([
        reservation({ status: 'consumed', orderLineId: 'line-1' }),
      ]);
      inventory.findLivePositionsByProductIds.mockResolvedValue([
        position({ productVariantId: 'ol_variant_2', inventoryItemId: 'inv-2' }),
      ]);

      const result = await service.reserveForOrder({
        orderRecordId: ORDER_ID,
        atpEffect: 'published',
        now: NOW,
        lines: [line({ orderLineId: 'line-2', productVariantId: 'ol_variant_2' })],
      });

      expect(result.skipped).toEqual([]);
      expect(reservations.claimHeld.mock.calls[0][0][0].orderLineId).toBe('line-2');
    });
  });

  describe('consumeForOrder (#2347)', () => {
    it('should move every held row to consumed, passing the terminal status as data', async () => {
      // Consume adds NO repository method: `releaseHeld` already takes the
      // terminal status as data (§ 6I), which is what keeps release, consume and
      // expire from drifting into three near-identical WHERE clauses.
      reservations.listHeldByOrderRecordId.mockResolvedValue([
        reservation({ orderLineId: 'line-1', inventoryItemId: 'inv-1' }),
        reservation({ orderLineId: 'line-2', inventoryItemId: 'inv-2' }),
      ]);
      reservations.releaseHeld.mockResolvedValue(reservation({ status: 'consumed' }));

      const result = await service.consumeForOrder({ orderRecordId: ORDER_ID });

      expect(result).toEqual({ consumed: 2, alreadyTerminal: 0, failed: 0 });
      expect(reservations.releaseHeld).toHaveBeenCalledTimes(2);
      expect(reservations.releaseHeld).toHaveBeenCalledWith({
        orderRecordId: ORDER_ID,
        orderLineId: 'line-1',
        inventoryItemId: 'inv-1',
        terminalStatus: 'consumed',
      });
    });

    it('should be a no-op when the order holds nothing', async () => {
      // The common case on a default install (reservations disabled, no mapped
      // position, or a peer already consumed) — legitimate, not a warning.
      reservations.listHeldByOrderRecordId.mockResolvedValue([]);

      const result = await service.consumeForOrder({ orderRecordId: ORDER_ID });

      expect(result).toEqual({ consumed: 0, alreadyTerminal: 0, failed: 0 });
      expect(reservations.releaseHeld).not.toHaveBeenCalled();
    });

    it('should count a ReservationNotHeldError as alreadyTerminal, never as failed', async () => {
      // This is the race the consume-then-claim ordering deliberately permits: a
      // peer sweep or a cancellation won the row between our read and our write.
      // Folding it into `failed` would make a healthy install alarm on every
      // retry — a loud false signal is its own defect, beside the silent one.
      reservations.listHeldByOrderRecordId.mockResolvedValue([
        reservation({ orderLineId: 'line-1' }),
        reservation({ orderLineId: 'line-2' }),
      ]);
      reservations.releaseHeld
        .mockRejectedValueOnce(new ReservationNotHeldError(ORDER_ID, 'line-1', 'inv-1'))
        .mockResolvedValueOnce(reservation({ status: 'consumed' }));

      const result = await service.consumeForOrder({ orderRecordId: ORDER_ID });

      expect(result).toEqual({ consumed: 1, alreadyTerminal: 1, failed: 0 });
    });

    it('should count an unexpected error as failed and still close the rest', async () => {
      // Per-row, never fatal: one bad row must not abort a call that can still
      // correctly close the remaining lines.
      reservations.listHeldByOrderRecordId.mockResolvedValue([
        reservation({ orderLineId: 'line-1' }),
        reservation({ orderLineId: 'line-2' }),
      ]);
      reservations.releaseHeld
        .mockRejectedValueOnce(new Error('deadlock detected'))
        .mockResolvedValueOnce(reservation({ status: 'consumed' }));

      const result = await service.consumeForOrder({ orderRecordId: ORDER_ID });

      expect(result).toEqual({ consumed: 1, alreadyTerminal: 0, failed: 1 });
    });

    it('should never touch availabilityQuantity — it writes only through releaseHeld', async () => {
      // AC-3. The master owns on-hand stock and reports the decrement itself on
      // its next sync; a second author would make the two drift.
      reservations.listHeldByOrderRecordId.mockResolvedValue([reservation()]);
      reservations.releaseHeld.mockResolvedValue(reservation({ status: 'consumed' }));

      await service.consumeForOrder({ orderRecordId: ORDER_ID });

      expect(inventory.findLivePositionsByProductIds).not.toHaveBeenCalled();
      expect(reservations.claimHeld).not.toHaveBeenCalled();
    });
  });

});
