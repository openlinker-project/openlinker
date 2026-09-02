/**
 * Reservation expiry — the fail-closed decision table (#2346, REVIEW § 3 C1)
 *
 * The C1 regression lives here rather than in an integration test, and that is
 * deliberate: `order_holds` (#2339) does not exist on this branch, so the only
 * honest way to exercise the `present` and `absent` arms is to INJECT the
 * predicate. No `order_holds` row is faked to make it look end-to-end.
 *
 * @module libs/core/src/inventory/application/services
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ReservationExpiryService } from '../reservation-expiry.service';
import {
  RESERVATION_OBLIGATION_READERS_TOKEN,
  RESERVATION_REPOSITORY_TOKEN,
} from '../../../inventory.tokens';
import { Reservation } from '../../../domain/entities/reservation.entity';
import type { ObligationReaders, ObligationVerdict } from '../../../domain/types/reservation-obligation.types';
import { UnavailableOrderHoldReader } from '../../../infrastructure/reservations/unavailable-order-hold.reader';

const NOW = new Date('2026-08-26T12:00:00.000Z');
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');
const RECENT = new Date('2026-08-25T12:00:00.000Z');
const OVERDUE = new Date('2026-08-20T00:00:00.000Z');

const heldReservation = (overrides: Partial<{ createdAt: Date; orderRecordId: string }> = {}) =>
  new Reservation(
    'res-1',
    overrides.orderRecordId ?? 'ol_order_1',
    'line-1',
    'ol_inventoryitem_1',
    2,
    'held',
    OVERDUE,
    'published',
    overrides.createdAt ?? RECENT,
    RECENT,
    null
  );

describe('ReservationExpiryService', () => {
  let repository: {
    listHeldExpiredBefore: jest.Mock;
    releaseHeld: jest.Mock;
    extendHeldExpiry: jest.Mock;
  };

  const build = async (readers: ObligationReaders): Promise<ReservationExpiryService> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReservationExpiryService,
        { provide: RESERVATION_REPOSITORY_TOKEN, useValue: repository },
        { provide: RESERVATION_OBLIGATION_READERS_TOKEN, useValue: readers },
      ],
    }).compile();
    return module.get(ReservationExpiryService);
  };

  const answering = (verdict: ObligationVerdict): ObligationReaders => ({
    'open-order-hold': () => Promise.resolve(verdict),
  });

  beforeEach(() => {
    repository = {
      listHeldExpiredBefore: jest.fn().mockResolvedValue([]),
      releaseHeld: jest.fn().mockResolvedValue(undefined),
      extendHeldExpiry: jest.fn().mockResolvedValue(undefined),
    };
  });

  it('should do nothing when no hold is overdue', async () => {
    const service = await build(answering('absent'));

    const result = await service.expireDueReservations({ limit: 10, now: NOW });

    expect(result).toEqual({ examined: 0, released: 0, extended: 0, escalated: 0, failed: 0 });
    expect(repository.releaseHeld).not.toHaveBeenCalled();
    expect(repository.extendHeldExpiry).not.toHaveBeenCalled();
  });

  describe('the C1 regression: an obligation must never be released', () => {
    it('should EXTEND, not release, when an obligation is present', async () => {
      repository.listHeldExpiredBefore.mockResolvedValue([heldReservation()]);
      const service = await build(answering('present'));

      const result = await service.expireDueReservations({ limit: 10, now: NOW });

      expect(repository.releaseHeld).not.toHaveBeenCalled();
      expect(repository.extendHeldExpiry).toHaveBeenCalledTimes(1);
      expect(result.extended).toBe(1);
      expect(result.released).toBe(0);
    });

    it('should EXTEND, not release, when the obligation is merely indeterminate', async () => {
      repository.listHeldExpiredBefore.mockResolvedValue([heldReservation()]);
      const service = await build(answering('indeterminate'));

      const result = await service.expireDueReservations({ limit: 10, now: NOW });

      // Fail closed: "I could not tell" republishes nothing.
      expect(repository.releaseHeld).not.toHaveBeenCalled();
      expect(result.extended).toBe(1);
    });

    it('should release only on a positively confirmed absence', async () => {
      repository.listHeldExpiredBefore.mockResolvedValue([heldReservation()]);
      const service = await build(answering('absent'));

      const result = await service.expireDueReservations({ limit: 10, now: NOW });

      expect(repository.extendHeldExpiry).not.toHaveBeenCalled();
      expect(repository.releaseHeld).toHaveBeenCalledWith(
        expect.objectContaining({ terminalStatus: 'expired' })
      );
      expect(result.released).toBe(1);
    });

    it('should release NOTHING while the shipped placeholder reader is bound', async () => {
      repository.listHeldExpiredBefore.mockResolvedValue([heldReservation()]);
      const holds = new UnavailableOrderHoldReader();
      const service = await build({
        'open-order-hold': (orderRecordId) => holds.read(orderRecordId),
      });

      const result = await service.expireDueReservations({ limit: 10, now: NOW });

      expect(repository.releaseHeld).not.toHaveBeenCalled();
      expect(result.released).toBe(0);
      expect(result.extended).toBe(1);
    });
  });

  describe('extension', () => {
    it('should move expiresAt forward and touch nothing else', async () => {
      repository.listHeldExpiredBefore.mockResolvedValue([heldReservation()]);
      const service = await build(answering('present'));

      await service.expireDueReservations({ limit: 10, now: NOW });

      const [input] = repository.extendHeldExpiry.mock.calls[0] as [Record<string, unknown>];
      expect(Object.keys(input).sort()).toEqual(
        ['expiresAt', 'inventoryItemId', 'orderLineId', 'orderRecordId'].sort()
      );
      // `atpEffect` is immutable — rewriting it would move a published quantity
      // with no audit trail.
      expect(input).not.toHaveProperty('atpEffect');
      expect((input.expiresAt as Date).getTime()).toBeGreaterThan(NOW.getTime());
    });

    it('should extend every hold in one run to the SAME instant', async () => {
      repository.listHeldExpiredBefore.mockResolvedValue([
        heldReservation({ orderRecordId: 'ol_order_1' }),
        heldReservation({ orderRecordId: 'ol_order_2' }),
      ]);
      const service = await build(answering('indeterminate'));

      await service.expireDueReservations({ limit: 10, now: NOW });

      const calls = repository.extendHeldExpiry.mock.calls as [{ expiresAt: Date }][];
      expect(calls[0][0].expiresAt.getTime()).toBe(calls[1][0].expiresAt.getTime());
    });
  });

  describe('the age bound', () => {
    it('should escalate a hold older than the bound but STILL extend it', async () => {
      repository.listHeldExpiredBefore.mockResolvedValue([
        heldReservation({ createdAt: LONG_AGO }),
      ]);
      const service = await build(answering('indeterminate'));

      const result = await service.expireDueReservations({ limit: 10, now: NOW });

      expect(result.escalated).toBe(1);
      // No amount of elapsed time makes a possibly-promised unit safe to
      // republish, so the age bound reports — it never releases.
      expect(repository.releaseHeld).not.toHaveBeenCalled();
      expect(result.extended).toBe(1);
    });

    it('should not escalate a recently created hold', async () => {
      repository.listHeldExpiredBefore.mockResolvedValue([
        heldReservation({ createdAt: RECENT }),
      ]);
      const service = await build(answering('indeterminate'));

      expect((await service.expireDueReservations({ limit: 10, now: NOW })).escalated).toBe(0);
    });
  });

  describe('failure isolation', () => {
    it('should count a failing candidate and keep processing the rest of the page', async () => {
      repository.listHeldExpiredBefore.mockResolvedValue([
        heldReservation({ orderRecordId: 'ol_order_bad' }),
        heldReservation({ orderRecordId: 'ol_order_good' }),
      ]);
      repository.extendHeldExpiry
        .mockRejectedValueOnce(new Error('row went terminal'))
        .mockResolvedValueOnce(undefined);
      const service = await build(answering('present'));

      const result = await service.expireDueReservations({ limit: 10, now: NOW });

      expect(result.failed).toBe(1);
      expect(result.extended).toBe(1);
      expect(result.examined).toBe(2);
    });

    it('should report a wholly failed page, because a failing row is re-read at the head of the ordering', async () => {
      repository.listHeldExpiredBefore.mockResolvedValue([heldReservation()]);
      repository.extendHeldExpiry.mockRejectedValue(new Error('write refused'));
      const service = await build(answering('present'));
      const logged: string[] = [];
      jest
        .spyOn(
          (service as unknown as { logger: { error: (m: string) => void } }).logger,
          'error'
        )
        .mockImplementation((message: string) => {
          logged.push(message);
        });

      const result = await service.expireDueReservations({ limit: 10, now: NOW });

      expect(result.failed).toBe(1);
      // Candidates are ordered oldest-overdue-first and a row leaves the set only
      // by being written, so a permanently failing one starves the rest.
      expect(logged.some((m) => m.includes('reservation_expiry_page_all_failed'))).toBe(true);
    });

    it('should not report a starvation signal when only some candidates failed', async () => {
      repository.listHeldExpiredBefore.mockResolvedValue([
        heldReservation({ orderRecordId: 'ol_order_bad' }),
        heldReservation({ orderRecordId: 'ol_order_good' }),
      ]);
      repository.extendHeldExpiry
        .mockRejectedValueOnce(new Error('write refused'))
        .mockResolvedValueOnce(undefined);
      const service = await build(answering('present'));
      const logged: string[] = [];
      jest
        .spyOn(
          (service as unknown as { logger: { error: (m: string) => void } }).logger,
          'error'
        )
        .mockImplementation((message: string) => {
          logged.push(message);
        });

      await service.expireDueReservations({ limit: 10, now: NOW });

      expect(logged.some((m) => m.includes('reservation_expiry_page_all_failed'))).toBe(false);
    });
  });
});
