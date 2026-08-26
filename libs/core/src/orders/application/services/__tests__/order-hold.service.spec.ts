/**
 * Order Hold Service — unit tests (#2339)
 *
 * The repository is mocked: its concurrency semantics are #2338's and are
 * covered by `order-hold.repository.spec.ts` plus the int-spec. What is under
 * test here is the three things the service adds — the clock, §6.4's release
 * policy, and the internal-only lifecycle fact.
 */
import { OrderHold } from '../../../domain/entities/order-hold.entity';
import { HoldAlreadyReleasedError } from '../../../domain/exceptions/hold-already-released.error';
import { HoldReleaseNotPermittedError } from '../../../domain/exceptions/hold-release-not-permitted.error';
import { HoldReleaseNoteRequiredError } from '../../../domain/exceptions/hold-release-note-required.error';
import { OrderHoldNotFoundError } from '../../../domain/exceptions/order-hold-not-found.error';
import type { OrderHoldRepositoryPort } from '../../../domain/ports/order-hold-repository.port';
import { OrderHoldService } from '../order-hold.service';
import {
  OmsLifecycleFactTypeValues,
  type HoldReason,
} from '@openlinker/core/order-lifecycle';
import { OrderLifecycleEventTypeValues } from '../../../domain/types/order-lifecycle-event.types';

function hold(overrides: Partial<OrderHold> = {}): OrderHold {
  const base = new OrderHold(
    'hold-1',
    'ol_order_1',
    'stock-shortfall' as HoldReason,
    null,
    null,
    'inventory-automation',
    new Date('2026-01-01T00:00:00.000Z'),
    null,
    null,
    null,
    new Date('2026-01-01T00:00:00.000Z'),
    new Date('2026-01-01T00:00:00.000Z')
  );
  return Object.assign(Object.create(OrderHold.prototype) as OrderHold, base, overrides);
}

describe('OrderHoldService', () => {
  let repository: jest.Mocked<OrderHoldRepositoryPort>;
  let service: OrderHoldService;

  beforeEach(() => {
    repository = {
      placeIfNoneOpen: jest.fn(),
      releaseHeld: jest.fn(),
      findById: jest.fn(),
      findOpenByOrder: jest.fn(),
      findOpenByOrders: jest.fn(),
      listByOrder: jest.fn(),
      listOpenPlacedBefore: jest.fn(),
      listOpenHolds: jest.fn(),
    } as unknown as jest.Mocked<OrderHoldRepositoryPort>;
    service = new OrderHoldService(repository);
  });

  describe('place', () => {
    it('should stamp placedAt from OL clock and emit a held fact when the slot is free', async () => {
      const placed = hold();
      repository.placeIfNoneOpen.mockResolvedValue(placed);

      const result = await service.place({
        internalOrderId: 'ol_order_1',
        reason: 'stock-shortfall',
        note: '  short by two  ',
        placedBy: { kind: 'service', service: 'inventory-automation' },
      });

      const input = repository.placeIfNoneOpen.mock.calls[0][0];
      expect(input.placedAt).toBeInstanceOf(Date);
      // Trimmed, because whitespace is absence and not operator content.
      expect(input.note).toBe('short by two');
      expect(result.hold).toBe(placed);
      expect(result.fact).toEqual({
        type: 'held',
        internalOrderId: 'ol_order_1',
        reason: 'stock-shortfall',
      });
    });

    it('should normalise a whitespace-only note to null when placing', async () => {
      repository.placeIfNoneOpen.mockResolvedValue(hold());

      await service.place({
        internalOrderId: 'ol_order_1',
        reason: 'operator',
        note: '   ',
        placedBy: { kind: 'user', userId: 'user-1' },
      });

      expect(repository.placeIfNoneOpen.mock.calls[0][0].note).toBeNull();
    });

    it('should propagate a repository refusal rather than translating it', async () => {
      const error = new Error('already');
      repository.placeIfNoneOpen.mockRejectedValue(error);

      await expect(
        service.place({
          internalOrderId: 'ol_order_1',
          reason: 'operator',
          note: null,
          placedBy: { kind: 'user', userId: 'user-1' },
        })
      ).rejects.toBe(error);
    });
  });

  describe('release', () => {
    it('should throw OrderHoldNotFoundError when no such hold exists', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.release({ holdId: 'nope', releasedBy: { kind: 'user', userId: 'u' } })
      ).rejects.toBeInstanceOf(OrderHoldNotFoundError);
      expect(repository.releaseHeld).not.toHaveBeenCalled();
    });

    it('should throw HoldAlreadyReleasedError when the hold is already released', async () => {
      repository.findById.mockResolvedValue(
        hold({ releasedAt: new Date('2026-02-01T00:00:00.000Z') })
      );

      await expect(
        service.release({ holdId: 'hold-1', releasedBy: { kind: 'user', userId: 'u' } })
      ).rejects.toBeInstanceOf(HoldAlreadyReleasedError);
      expect(repository.releaseHeld).not.toHaveBeenCalled();
    });

    it('should require a release note when a user releases a service-placed hold', async () => {
      repository.findById.mockResolvedValue(hold());

      await expect(
        service.release({
          holdId: 'hold-1',
          note: '   ',
          releasedBy: { kind: 'user', userId: 'user-1' },
        })
      ).rejects.toBeInstanceOf(HoldReleaseNoteRequiredError);
      // Nothing was stamped: a refused release must leave no trace of having
      // half-happened.
      expect(repository.releaseHeld).not.toHaveBeenCalled();
    });

    it('should allow a user to release a service-placed hold when a note is supplied', async () => {
      repository.findById.mockResolvedValue(hold());
      repository.releaseHeld.mockResolvedValue(
        hold({ releasedAt: new Date(), releasedByUserId: 'user-1', releaseNote: 'verified by hand' })
      );

      const result = await service.release({
        holdId: 'hold-1',
        note: 'verified by hand',
        releasedBy: { kind: 'user', userId: 'user-1' },
      });

      expect(repository.releaseHeld).toHaveBeenCalledWith(
        expect.objectContaining({
          holdId: 'hold-1',
          releaseNote: 'verified by hand',
          releasedByUserId: 'user-1',
        })
      );
      expect(result.fact.type).toBe('released');
    });

    it('should allow the placing service to release its own hold with no note', async () => {
      repository.findById.mockResolvedValue(hold());
      repository.releaseHeld.mockResolvedValue(hold({ releasedAt: new Date() }));

      await service.release({
        holdId: 'hold-1',
        releasedBy: { kind: 'service', service: 'inventory-automation' },
      });

      expect(repository.releaseHeld).toHaveBeenCalledWith(
        expect.objectContaining({ releaseNote: null, releasedByUserId: null })
      );
    });

    it('should refuse a different service releasing another service-placed hold', async () => {
      repository.findById.mockResolvedValue(hold());

      await expect(
        service.release({
          holdId: 'hold-1',
          note: 'looks fine to me',
          releasedBy: { kind: 'service', service: 'fraud-automation' },
        })
      ).rejects.toBeInstanceOf(HoldReleaseNotPermittedError);
      expect(repository.releaseHeld).not.toHaveBeenCalled();
    });

    it('should refuse a service releasing a USER-placed hold', async () => {
      repository.findById.mockResolvedValue(
        hold({ placedByService: null, placedByUserId: 'user-1' })
      );

      await expect(
        service.release({
          holdId: 'hold-1',
          releasedBy: { kind: 'service', service: 'inventory-automation' },
        })
      ).rejects.toBeInstanceOf(HoldReleaseNotPermittedError);
      expect(repository.releaseHeld).not.toHaveBeenCalled();
    });

    it('should not require a note when a user releases a user-placed hold', async () => {
      repository.findById.mockResolvedValue(
        hold({ placedByService: null, placedByUserId: 'user-1' })
      );
      repository.releaseHeld.mockResolvedValue(hold({ releasedAt: new Date() }));

      await expect(
        service.release({ holdId: 'hold-1', releasedBy: { kind: 'user', userId: 'user-2' } })
      ).resolves.toBeDefined();
    });
  });

  describe('lifecycle facts', () => {
    it('should emit only internal fact types and never a relayable lifecycle event', async () => {
      repository.placeIfNoneOpen.mockResolvedValue(hold());
      repository.findById.mockResolvedValue(hold());
      repository.releaseHeld.mockResolvedValue(hold({ releasedAt: new Date() }));

      const placed = await service.place({
        internalOrderId: 'ol_order_1',
        reason: 'operator',
        note: null,
        placedBy: { kind: 'user', userId: 'u' },
      });
      const released = await service.release({
        holdId: 'hold-1',
        releasedBy: { kind: 'service', service: 'inventory-automation' },
      });

      for (const fact of [placed.fact, released.fact]) {
        expect(OmsLifecycleFactTypeValues).toContain(fact.type);
        // The §6.6 split, asserted rather than assumed: neither fact is a member
        // of the RELAY union, so no `OrderStatusWriteback` adapter can ever be
        // asked to express it.
        expect(OrderLifecycleEventTypeValues as readonly string[]).not.toContain(fact.type);
      }
    });
  });

  describe('getOpenHold', () => {
    it('should read order_holds — the authority — rather than any projection', async () => {
      const open = hold();
      repository.findOpenByOrder.mockResolvedValue(open);

      await expect(service.getOpenHold('ol_order_1')).resolves.toBe(open);
      expect(repository.findOpenByOrder).toHaveBeenCalledWith('ol_order_1');
    });
  });
});
