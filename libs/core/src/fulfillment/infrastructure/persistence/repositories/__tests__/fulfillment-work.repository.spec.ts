/**
 * FulfillmentWorkRepository — unit specs (#2392)
 *
 * These cover the behaviour that is the repository's OWN, not the database's:
 * the `affected ?? 0` contract, the `23505` translation, the two-cause
 * `releaseHold` disambiguation, and the hold cap's refusal.
 *
 * **What is deliberately NOT asserted here**: that the ≤10 cap holds under
 * concurrency. A mocked datasource cannot produce a phantom read, so a unit test
 * of that property would pass against the broken implementation and prove
 * nothing. It lives in `fulfillment-work-transitions.int-spec.ts` as a
 * genuinely concurrent test.
 */
import { QueryFailedError } from 'typeorm';

// Imported for the format-drift guard at the bottom of this file. A SPEC may
// value-import a sibling context — the leaf walker excludes `*.spec.ts` — which
// is exactly what lets the repository's local minter be checked against the
// real one.
import { formatInternalId } from '@openlinker/core/identifier-mapping';

import { FulfillmentHoldAlreadyReleasedError } from '../../../../domain/exceptions/fulfillment-hold-already-released.error';
import { FulfillmentHoldLimitExceededError } from '../../../../domain/exceptions/fulfillment-hold-limit-exceeded.error';
import { FulfillmentHoldNotFoundError } from '../../../../domain/exceptions/fulfillment-hold-not-found.error';
import { FulfillmentPersistenceError } from '../../../../domain/exceptions/fulfillment-persistence.error';
import { FulfillmentWorkNotFoundError } from '../../../../domain/exceptions/fulfillment-work-not-found.error';
import { FulfillmentWorkVersionMismatchError } from '../../../../domain/exceptions/fulfillment-work-version-mismatch.error';
import { FULFILLMENT_HOLD_ACTIVE_LIMIT } from '../../../../domain/types/fulfillment-hold.types';
import { FulfillmentWorkRepository } from '../fulfillment-work.repository';

type Mock = jest.Mock;

/** Reads the first argument of a mock's first call without an `any` hop. */
const firstArgOf = <T>(mock: Mock): T => (mock.mock.calls as unknown[][])[0][0] as T;

/** The first argument of EVERY call, for asserting a guard clause was emitted. */
const argsOf = (mock: Mock): unknown[] => (mock.mock.calls as unknown[][]).map((call) => call[0]);

const updateQueryBuilder = (result: { affected?: number; raw?: unknown[] }) => {
  const qb: Record<string, unknown> = {};
  for (const method of ['update', 'set', 'where', 'andWhere', 'returning']) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  qb.execute = jest.fn().mockResolvedValue(result);
  return qb;
};

const makeRepository = (overrides: {
  works?: Partial<Record<string, unknown>>;
  lines?: Partial<Record<string, unknown>>;
  holds?: Partial<Record<string, unknown>>;
  rejections?: Partial<Record<string, unknown>>;
  verifications?: Partial<Record<string, unknown>>;
  dataSource?: Partial<Record<string, unknown>>;
}) => {
  const works = {
    createQueryBuilder: jest.fn(),
    update: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    ...overrides.works,
  };
  const lines = { createQueryBuilder: jest.fn(), find: jest.fn(), ...overrides.lines };
  const holds = {
    createQueryBuilder: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    ...overrides.holds,
  };
  const rejections = { createQueryBuilder: jest.fn(), find: jest.fn(), ...overrides.rejections };
  const verifications = {
    createQueryBuilder: jest.fn(),
    find: jest.fn(),
    ...overrides.verifications,
  };
  const dataSource = { transaction: jest.fn(), ...overrides.dataSource };
  return {
    repo: new FulfillmentWorkRepository(
      works as never,
      lines as never,
      holds as never,
      rejections as never,
      verifications as never,
      dataSource as never
    ),
    works,
    lines,
    holds,
    rejections,
    dataSource,
  };
};

describe('FulfillmentWorkRepository', () => {
  describe('conditional transitions', () => {
    it('should report applied when the precondition matched a row', async () => {
      const qb = updateQueryBuilder({ affected: 1 });
      const { repo } = makeRepository({
        works: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      await expect(
        repo.transitionStatus({ workId: 'w1', from: ['open'], to: 'scheduled' })
      ).resolves.toBe(true);
    });

    it('should report NOT applied when the precondition no longer held', async () => {
      // The stale-precondition contract: zero rows means nothing was written,
      // and that is an ordinary outcome rather than an error.
      const qb = updateQueryBuilder({ affected: 0 });
      const { repo } = makeRepository({
        works: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      await expect(
        repo.transitionStatus({ workId: 'w1', from: ['open'], to: 'scheduled' })
      ).resolves.toBe(false);
    });

    it('should treat an undefined affected count as NOT applied', async () => {
      // `?? 0` is load-bearing, not stylistic: an undefined coercing to a truthy
      // claim is the silent double-apply shape.
      const qb = updateQueryBuilder({ affected: undefined });
      const { repo } = makeRepository({
        works: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      await expect(
        repo.transitionRequestStatus({ workId: 'w1', from: ['submitted'], to: 'accepted' })
      ).resolves.toBe(false);
    });

    it('should bump the version in the same statement as the axis move', async () => {
      const qb = updateQueryBuilder({ affected: 1 });
      const { repo } = makeRepository({
        works: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      await repo.transitionStatus({ workId: 'w1', from: ['open'], to: 'in_progress' });

      const setArg = firstArgOf<Record<string, unknown>>(qb.set as Mock);
      expect(typeof setArg.version).toBe('function');
      expect((setArg.version as () => string)()).toBe('"version" + 1');
    });

    it('should convert an unexpected database error into a domain error', async () => {
      const qb = updateQueryBuilder({ affected: 1 });
      (qb.execute as Mock).mockRejectedValue(new Error('connection reset'));
      const { repo } = makeRepository({
        works: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      await expect(
        repo.transitionStatus({ workId: 'w1', from: ['open'], to: 'closed' })
      ).rejects.toBeInstanceOf(FulfillmentPersistenceError);
    });
  });

  describe('claimDispatchRelay', () => {
    it('should claim exactly once', async () => {
      const qb = updateQueryBuilder({ affected: 1 });
      const { repo } = makeRepository({
        works: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      await expect(repo.claimDispatchRelay('w1', new Date())).resolves.toBe(true);
      // The IS NULL guard is what makes it at-most-once.
      expect(argsOf(qb.andWhere as Mock)).toContain('"dispatchRelayedAt" IS NULL');
    });

    it('should report not-claimed on a second call', async () => {
      const qb = updateQueryBuilder({ affected: 0 });
      const { repo } = makeRepository({
        works: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      await expect(repo.claimDispatchRelay('w1', new Date())).resolves.toBe(false);
    });

    it('should bump the version, because a relay claim is a header transition', async () => {
      // An observer seeing the relay claimed at an UNCHANGED version is the
      // false-negative direction for optimistic concurrency.
      const qb = updateQueryBuilder({ affected: 1 });
      const { repo } = makeRepository({
        works: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      await repo.claimDispatchRelay('w1', new Date());

      const setArg = firstArgOf<Record<string, unknown>>(qb.set as Mock);
      expect((setArg.version as () => string)()).toBe('"version" + 1');
    });
  });

  describe('markInvoicePrinted / markLabelPrinted (pack-bench completion)', () => {
    it('should stamp invoicePrintedAt on the first call', async () => {
      const qb = updateQueryBuilder({ affected: 1 });
      const { repo } = makeRepository({
        works: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      const at = new Date();
      await expect(repo.markInvoicePrinted('w1', at)).resolves.toBe(true);
      expect(argsOf(qb.andWhere as Mock)).toContain('"invoicePrintedAt" IS NULL');
      expect(firstArgOf<Record<string, unknown>>(qb.set as Mock)).toEqual({
        invoicePrintedAt: at,
      });
    });

    it('should report not-applied on a reprint, without erroring', async () => {
      const qb = updateQueryBuilder({ affected: 0 });
      const { repo } = makeRepository({
        works: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      await expect(repo.markInvoicePrinted('w1', new Date())).resolves.toBe(false);
    });

    it('should NOT bump version — a display-only fact, not a legality-gated one', async () => {
      const qb = updateQueryBuilder({ affected: 1 });
      const { repo } = makeRepository({
        works: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      await repo.markInvoicePrinted('w1', new Date());

      const setArg = firstArgOf<Record<string, unknown>>(qb.set as Mock);
      expect(setArg).not.toHaveProperty('version');
    });

    it('should stamp labelPrintedAt on the first call, and never bump version', async () => {
      const qb = updateQueryBuilder({ affected: 1 });
      const { repo } = makeRepository({
        works: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      const at = new Date();
      await expect(repo.markLabelPrinted('w1', at)).resolves.toBe(true);
      expect(argsOf(qb.andWhere as Mock)).toContain('"labelPrintedAt" IS NULL');
      const setArg = firstArgOf<Record<string, unknown>>(qb.set as Mock);
      expect(setArg).toEqual({ labelPrintedAt: at });
      expect(setArg).not.toHaveProperty('version');
    });

    it('should report not-applied on a repeated label stamp', async () => {
      const qb = updateQueryBuilder({ affected: 0 });
      const { repo } = makeRepository({
        works: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      await expect(repo.markLabelPrinted('w1', new Date())).resolves.toBe(false);
    });
  });

  describe('claimCompletion (pack-bench completion)', () => {
    it('should claim exactly once, guarded on the negative AND the prerequisite state', async () => {
      const qb = updateQueryBuilder({ affected: 1 });
      const { repo } = makeRepository({
        works: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      const at = new Date();
      await expect(
        repo.claimCompletion({
          workId: 'w1',
          completedAt: at,
          completedByUserId: 'u1',
          expectedVersion: 3,
        })
      ).resolves.toBe(true);

      const guards = argsOf(qb.andWhere as Mock);
      expect(guards).toContain('"completedAt" IS NULL');
      expect(guards).toContain('"parcelClosedAt" IS NOT NULL');
      expect(guards).toContain('"version" = :expectedVersion');
      expect(firstArgOf<Record<string, unknown>>(qb.set as Mock)).toMatchObject({
        completedAt: at,
        completedByUserId: 'u1',
      });
    });

    it('should DO bump version — the terminal legality-gated act on this surface', async () => {
      const qb = updateQueryBuilder({ affected: 1 });
      const { repo } = makeRepository({
        works: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      await repo.claimCompletion({
        workId: 'w1',
        completedAt: new Date(),
        completedByUserId: 'u1',
        expectedVersion: 0,
      });

      const setArg = firstArgOf<Record<string, unknown>>(qb.set as Mock);
      expect((setArg.version as () => string)()).toBe('"version" + 1');
    });

    it('should report not-applied when the guard does not hold', async () => {
      const qb = updateQueryBuilder({ affected: 0 });
      const { repo } = makeRepository({
        works: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      await expect(
        repo.claimCompletion({
          workId: 'w1',
          completedAt: new Date(),
          completedByUserId: 'u1',
          expectedVersion: 0,
        })
      ).resolves.toBe(false);
    });
  });

  describe('assignment (#3336, ADR-074)', () => {
    it('should assign a packer with no IS NULL guard — reassignment is legal', async () => {
      const qb = updateQueryBuilder({ affected: 1 });
      const { repo } = makeRepository({
        works: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      await expect(repo.assignToPacker('w1', 'user-1')).resolves.toBe(true);
      // Unlike `assignHolder`, `assignToPacker` guards only on the row's
      // existence — ADR-074 requires a supervisor to be able to reassign an
      // idle parcel, so no `IS NULL` clause may appear here.
      expect(argsOf(qb.andWhere as Mock)).not.toContain('"assignedToUserId" IS NULL');
    });

    it('should report not-applied when the work object no longer exists', async () => {
      const qb = updateQueryBuilder({ affected: 0 });
      const { repo } = makeRepository({
        works: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      await expect(repo.assignToPacker('w1', 'user-1')).resolves.toBe(false);
    });

    it('should bump the version on assignToPacker, because it is a header transition', async () => {
      const qb = updateQueryBuilder({ affected: 1 });
      const { repo } = makeRepository({
        works: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      await repo.assignToPacker('w1', 'user-1');

      const setArg = firstArgOf<Record<string, unknown>>(qb.set as Mock);
      expect(setArg.assignedToUserId).toBe('user-1');
      expect((setArg.version as () => string)()).toBe('"version" + 1');
    });

    it('should clear an assignment only when one exists', async () => {
      const qb = updateQueryBuilder({ affected: 1 });
      const { repo } = makeRepository({
        works: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      await expect(repo.clearAssignment('w1')).resolves.toBe(true);
      // Mirrors `clearHolder` — guarded so a redundant clear reports the
      // ordinary no-op outcome rather than a false "applied".
      expect(argsOf(qb.andWhere as Mock)).toContain('"assignedToUserId" IS NOT NULL');

      // ADR-074 / #3360: the exclusivity flag is reset in the SAME statement.
      // Asserted on the `set` payload rather than through a second call,
      // because "same statement" is the property — two writes would leave a
      // window in which the parcel is unassigned AND still locked, which is
      // exactly the state `CHK_fulfillment_works_exclusive_needs_packer`
      // forbids.
      const setArg = firstArgOf<Record<string, unknown>>(qb.set as Mock);
      expect(setArg.assignedToUserId).toBeNull();
      expect(setArg.selfServeEligible).toBe(true);
    });

    it('should reset selfServeEligible to true in the same statement (ADR-074 review round 2)', async () => {
      const qb = updateQueryBuilder({ affected: 1 });
      const { repo } = makeRepository({
        works: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      await repo.clearAssignment('w1');

      // Without this, `assignToPacker(A) -> setSelfServeEligible(false) ->
      // clearAssignment -> assignToPacker(B)` would leave B exclusively
      // locked by a decision nobody made about them.
      const setArg = firstArgOf<Record<string, unknown>>(qb.set as Mock);
      expect(setArg.assignedToUserId).toBeNull();
      expect(setArg.selfServeEligible).toBe(true);
    });

    it('should report not-applied clearing an already-unassigned parcel', async () => {
      const qb = updateQueryBuilder({ affected: 0 });
      const { repo } = makeRepository({
        works: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      await expect(repo.clearAssignment('w1')).resolves.toBe(false);
    });

    it('should refuse to lock an unassigned parcel (ADR-074 - exclusive-to-nobody)', async () => {
      const qb = updateQueryBuilder({ affected: 1 });
      const { repo } = makeRepository({
        works: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      await expect(repo.setSelfServeEligible('w1', false)).resolves.toBe(true);

      const setArg = firstArgOf<Record<string, unknown>>(qb.set as Mock);
      expect(setArg.selfServeEligible).toBe(false);
      expect(argsOf(qb.andWhere as Mock)).toContain('"assignedToUserId" IS NOT NULL');
    });

    it('should leave the true direction unguarded, since it is the state clearAssignment restores', async () => {
      const qb = updateQueryBuilder({ affected: 1 });
      const { repo } = makeRepository({
        works: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      await expect(repo.setSelfServeEligible('w1', true)).resolves.toBe(true);

      expect(qb.andWhere as Mock).not.toHaveBeenCalled();
    });

    it('should report not-applied for setSelfServeEligible when the work is gone', async () => {
      const qb = updateQueryBuilder({ affected: 0 });
      const { repo } = makeRepository({
        works: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      await expect(repo.setSelfServeEligible('w1', true)).resolves.toBe(false);
    });

    it('should convert an unexpected database error into a domain error', async () => {
      const qb = updateQueryBuilder({ affected: 1 });
      (qb.execute as Mock).mockRejectedValue(new Error('connection reset'));
      const { repo } = makeRepository({
        works: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      await expect(repo.assignToPacker('w1', 'user-1')).rejects.toBeInstanceOf(
        FulfillmentPersistenceError
      );
    });
  });

  describe('claimAssignment (#3340 follow-up) — the exclusive unassigned -> mine transition', () => {
    it('should guard on "assignedToUserId" IS NULL, unlike assignToPacker', async () => {
      const qb = updateQueryBuilder({ affected: 1 });
      const { repo } = makeRepository({
        works: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      await expect(repo.claimAssignment('w1', 'user-1')).resolves.toBe(true);
      expect(argsOf(qb.andWhere as Mock)).toContain('"assignedToUserId" IS NULL');
      expect(firstArgOf<Record<string, unknown>>(qb.set as Mock)).toMatchObject({
        assignedToUserId: 'user-1',
      });
    });

    it('should report not-applied — never a false success — when a peer claimed it first', async () => {
      const qb = updateQueryBuilder({ affected: 0 });
      const { repo } = makeRepository({
        works: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      await expect(repo.claimAssignment('w1', 'user-1')).resolves.toBe(false);
    });

    it('should bump version — the terminal legality-gated act on this surface', async () => {
      const qb = updateQueryBuilder({ affected: 1 });
      const { repo } = makeRepository({
        works: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      await repo.claimAssignment('w1', 'user-1');

      const setArg = firstArgOf<Record<string, unknown>>(qb.set as Mock);
      expect((setArg.version as () => string)()).toBe('"version" + 1');
    });
  });

  describe('assignToPacker / clearAssignment / setSelfServeEligible — the lost-update guard (#3340 second follow-up)', () => {
    it('should compose the optional expectedVersion guard with assignToPacker’s existence-only precondition', async () => {
      const qb = updateQueryBuilder({ affected: 1 });
      const { repo } = makeRepository({
        works: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      await repo.assignToPacker('w1', 'user-1', 4);

      expect(argsOf(qb.andWhere as Mock)).toContain('"version" = :expectedVersion');
      expect(argsOf(qb.andWhere as Mock)).not.toContain('"assignedToUserId" IS NULL');
    });

    it('should NOT add a version guard when expectedVersion is omitted — every pre-existing caller unchanged', async () => {
      const qb = updateQueryBuilder({ affected: 1 });
      const { repo } = makeRepository({
        works: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      await repo.assignToPacker('w1', 'user-1');

      expect(argsOf(qb.andWhere as Mock)).not.toContain('"version" = :expectedVersion');
    });

    it('should compose the version guard with clearAssignment’s own IS NOT NULL precondition', async () => {
      const qb = updateQueryBuilder({ affected: 1 });
      const { repo } = makeRepository({
        works: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      await repo.clearAssignment('w1', 4);

      const guards = argsOf(qb.andWhere as Mock);
      expect(guards).toContain('"assignedToUserId" IS NOT NULL');
      expect(guards).toContain('"version" = :expectedVersion');
    });

    it('should apply the version guard to setSelfServeEligible too', async () => {
      const qb = updateQueryBuilder({ affected: 1 });
      const { repo } = makeRepository({
        works: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      await repo.setSelfServeEligible('w1', true, 4);

      expect(argsOf(qb.andWhere as Mock)).toContain('"version" = :expectedVersion');
    });
  });

  describe('undoCompletion (#3340 follow-up) — the mirror of claimCompletion', () => {
    it('should guard on "completedAt" IS NOT NULL and clear both completion columns', async () => {
      const qb = updateQueryBuilder({ affected: 1 });
      const { repo } = makeRepository({
        works: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      await expect(repo.undoCompletion({ workId: 'w1', expectedVersion: 3 })).resolves.toBe(true);

      const guards = argsOf(qb.andWhere as Mock);
      expect(guards).toContain('"completedAt" IS NOT NULL');
      expect(guards).toContain('"version" = :expectedVersion');
      expect(firstArgOf<Record<string, unknown>>(qb.set as Mock)).toMatchObject({
        completedAt: null,
        completedByUserId: null,
      });
    });

    it('should bump version, mirroring claimCompletion', async () => {
      const qb = updateQueryBuilder({ affected: 1 });
      const { repo } = makeRepository({
        works: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      await repo.undoCompletion({ workId: 'w1', expectedVersion: 0 });

      const setArg = firstArgOf<Record<string, unknown>>(qb.set as Mock);
      expect((setArg.version as () => string)()).toBe('"version" + 1');
    });

    it('should report not-applied when the guard does not hold', async () => {
      const qb = updateQueryBuilder({ affected: 0 });
      const { repo } = makeRepository({
        works: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      await expect(repo.undoCompletion({ workId: 'w1', expectedVersion: 0 })).resolves.toBe(false);
    });
  });

  describe('reopenParcel clears a stale completion (#3340 follow-up)', () => {
    /** `reopenParcel` needs BOTH a header UPDATE and a verification-void UPDATE, in one transaction. */
    const makeReopenManager = (headerAffected: number) => {
      const headerQb = updateQueryBuilder({ affected: headerAffected });
      const voidQb = updateQueryBuilder({ affected: 0 });
      const calls: unknown[] = [];
      const manager = {
        createQueryBuilder: jest.fn(() => {
          calls.push(undefined);
          return calls.length === 1 ? headerQb : voidQb;
        }),
      };
      return { manager, headerQb, voidQb };
    };

    it('should clear completedAt and completedByUserId in the SAME statement as parcelClosedAt', async () => {
      const { manager, headerQb } = makeReopenManager(1);
      const { repo } = makeRepository({
        dataSource: { transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)) },
      });

      const result = await repo.reopenParcel({
        workId: 'w1',
        reopenedByUserId: 'user-1',
        reopenedAt: new Date(),
      });

      expect(result).toBe(true);
      expect(firstArgOf<Record<string, unknown>>(headerQb.set as Mock)).toMatchObject({
        parcelClosedAt: null,
        packedByUserId: null,
        packedByService: null,
        completedAt: null,
        completedByUserId: null,
      });
    });

    it('should report not-applied, and void nothing, when the parcel was not closed', async () => {
      const { manager, voidQb } = makeReopenManager(0);
      const { repo } = makeRepository({
        dataSource: { transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)) },
      });

      const result = await repo.reopenParcel({
        workId: 'w1',
        reopenedByUserId: 'user-1',
        reopenedAt: new Date(),
      });

      expect(result).toBe(false);
      expect(voidQb.execute).not.toHaveBeenCalled();
    });
  });

  describe('empty transition preconditions', () => {
    it('should report not-applied rather than emitting IN () for an empty from-set', async () => {
      // `IN ()` is a syntax error, not an empty set — the caller would otherwise
      // get a FulfillmentPersistenceError wrapping a malformed statement instead
      // of the truthful "a transition from nothing can never apply".
      const createQueryBuilder = jest.fn();
      const { repo } = makeRepository({ works: { createQueryBuilder } });

      await expect(repo.transitionStatus({ workId: 'w1', from: [], to: 'closed' })).resolves.toBe(
        false
      );
      await expect(
        repo.transitionRequestStatus({ workId: 'w1', from: [], to: 'accepted' })
      ).resolves.toBe(false);
      expect(createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('recordLineProgress delta validation', () => {
    it.each([
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['a fraction', 1.5],
      ['a negative', -3],
    ])('should refuse %s before it reaches SQL', async (_label, delta) => {
      // Each of these was previously interpolated straight into the SET clause.
      // `NaN` renders as a bare word Postgres reads as a COLUMN REFERENCE; a
      // negative delta is valid SQL that silently runs the counter backwards.
      const createQueryBuilder = jest.fn();
      const { repo } = makeRepository({ lines: { createQueryBuilder } });

      await expect(
        repo.recordLineProgress({
          workId: 'w1',
          orderLineId: 'l1',
          fulfilledDelta: delta,
          cancelledDelta: 0,
        })
      ).rejects.toBeInstanceOf(RangeError);
      // Explicit rather than implied: the guard must run BEFORE any I/O, and
      // relying on RangeError-vs-TypeError to prove that is indirect.
      expect(createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    const uniqueViolation = (constraint: string): QueryFailedError => {
      const violation = new QueryFailedError('q', [], new Error('dup') as never);
      const driver = violation as QueryFailedError & { code?: string; constraint?: string };
      driver.code = '23505';
      driver.constraint = constraint;
      return violation;
    };

    it('should translate a line-uniqueness violation and NAME THE OFFENDING LINE', async () => {
      const { repo } = makeRepository({
        dataSource: {
          transaction: jest
            .fn()
            .mockRejectedValue(uniqueViolation('UQ_fulfillment_work_lines_work_order_line')),
        },
      });

      // 'b' is the duplicate. Reporting `lines[0]` ('a') would name a line that
      // is fine — and naming the offending one is the whole value of the error.
      await expect(
        repo.create({
          orderId: 'ol_order_1',
          locationId: null,
          deliveryMethod: null,
          assignedConnectionId: null,
          lines: [
            { orderLineId: 'a', productVariantId: 'v1', totalQuantity: 1 },
            { orderLineId: 'b', productVariantId: 'v2', totalQuantity: 1 },
            { orderLineId: 'b', productVariantId: 'v3', totalQuantity: 1 },
          ],
        })
      ).rejects.toMatchObject({
        name: 'DuplicateFulfillmentWorkLineError',
        orderLineId: 'b',
      });
    });

    it('should NOT report a header-table unique violation as a duplicate line', async () => {
      // A `23505` on any other constraint concerns a different table; calling it
      // a duplicate line names a row that is fine about a failure that is not
      // its own.
      const { repo } = makeRepository({
        dataSource: {
          transaction: jest.fn().mockRejectedValue(uniqueViolation('PK_fulfillment_works')),
        },
      });

      await expect(
        repo.create({
          orderId: 'ol_order_1',
          locationId: null,
          deliveryMethod: null,
          assignedConnectionId: null,
          lines: [{ orderLineId: 'l1', productVariantId: 'v1', totalQuantity: 1 }],
        })
      ).rejects.toBeInstanceOf(FulfillmentPersistenceError);
    });

    it('should let a database error carrying another code through as a persistence error', async () => {
      // A repository that swallowed every database error would be worse than
      // one that leaked.
      const other = new QueryFailedError('q', [], new Error('boom') as never);
      (other as QueryFailedError & { code?: string }).code = '23514';
      const { repo } = makeRepository({
        dataSource: { transaction: jest.fn().mockRejectedValue(other) },
      });

      await expect(
        repo.create({
          orderId: 'ol_order_1',
          locationId: null,
          deliveryMethod: null,
          assignedConnectionId: null,
          lines: [],
        })
      ).rejects.toBeInstanceOf(FulfillmentPersistenceError);
    });

    it('should use a caller-supplied EntityManager instead of opening its own transaction', async () => {
      // ADR-054 R1: N work rows + the order's terminalisation commit together,
      // which is impossible if this method always opens its own transaction.
      const save = jest
        .fn()
        .mockImplementationOnce((_e, header) => Promise.resolve(header))
        .mockImplementationOnce((_e, lines) => Promise.resolve(lines));
      const transaction = jest.fn();
      const { repo } = makeRepository({ dataSource: { transaction } });

      await repo.create(
        {
          orderId: 'ol_order_1',
          locationId: 'loc1',
          deliveryMethod: 'courier',
          assignedConnectionId: null,
          lines: [{ orderLineId: 'l1', productVariantId: 'v1', totalQuantity: 2 }],
        },
        { save } as never
      );

      expect(transaction).not.toHaveBeenCalled();
      expect(save).toHaveBeenCalledTimes(2);
    });
  });

  describe('placeHold', () => {
    it('should refuse past the active limit', async () => {
      const em = {
        createQueryBuilder: jest.fn().mockReturnValue({
          setLock: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue({ id: 'w1' }),
        }),
        count: jest.fn().mockResolvedValue(FULFILLMENT_HOLD_ACTIVE_LIMIT),
        save: jest.fn(),
        increment: jest.fn(),
      };
      const { repo } = makeRepository({
        dataSource: { transaction: jest.fn((cb: (m: unknown) => unknown) => cb(em)) },
      });

      await expect(
        repo.placeHold({
          workId: 'w1',
          reason: 'manual-review' as never,
          placedByUserId: 'u1',
          placedAt: new Date(),
        })
      ).rejects.toBeInstanceOf(FulfillmentHoldLimitExceededError);
      expect(em.save).not.toHaveBeenCalled();
    });

    it('should take a pessimistic_write lock on the PARENT work row before counting', async () => {
      // Not decoration: without this the count-then-insert is a phantom race and
      // the cap silently does not hold. Asserted so a later refactor cannot drop
      // the lock while leaving the count in place.
      const setLock = jest.fn().mockReturnThis();
      const em = {
        createQueryBuilder: jest.fn().mockReturnValue({
          setLock,
          where: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue({ id: 'w1' }),
        }),
        count: jest.fn().mockResolvedValue(0),
        save: jest.fn().mockImplementation((_e, hold) => Promise.resolve({ ...hold, id: 'h1' })),
        // Placing a hold bumps the parent's `version` in the SAME transaction
        // (#2406): the hold changes what is legal next, so a token that did not
        // move would let a stale client's next write through.
        increment: jest.fn(),
      };
      const { repo } = makeRepository({
        dataSource: { transaction: jest.fn((cb: (m: unknown) => unknown) => cb(em)) },
      });

      await repo.placeHold({
        workId: 'w1',
        reason: 'manual-review' as never,
        placedByService: 'router',
        placedAt: new Date(),
      });

      expect(setLock).toHaveBeenCalledWith('pessimistic_write');
    });

    it('should raise when the work does not exist', async () => {
      const em = {
        createQueryBuilder: jest.fn().mockReturnValue({
          setLock: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(null),
        }),
        count: jest.fn(),
        save: jest.fn(),
        increment: jest.fn(),
      };
      const { repo } = makeRepository({
        dataSource: { transaction: jest.fn((cb: (m: unknown) => unknown) => cb(em)) },
      });

      await expect(
        repo.placeHold({
          workId: 'missing',
          reason: 'manual-review' as never,
          placedByUserId: 'u1',
          placedAt: new Date(),
        })
      ).rejects.toBeInstanceOf(FulfillmentWorkNotFoundError);
    });
  });

  describe('releaseHold', () => {
    /**
     * `releaseHold` runs inside `dataSource.transaction` since #2406, because
     * the optimistic-token compare and the release have to be one atomic unit.
     * The mock therefore models an EntityManager, not the hold repository.
     */
    const releaseEm = (options: {
      existing: unknown;
      raw: unknown[];
      parent?: unknown;
    }): Record<string, Mock> => ({
      findOne: jest.fn().mockResolvedValue(options.existing),
      // ONE self-returning builder serving both roles the implementation asks
      // for — the `FOR UPDATE` parent read and the conditional UPDATE. A mock
      // whose `where()` returned a different object than its `getOne()` lives on
      // fails as a TypeError wrapped in FulfillmentPersistenceError, which looks
      // exactly like a guard that did not fire.
      createQueryBuilder: jest.fn().mockImplementation(() => {
        const qb: Record<string, unknown> = {};
        for (const method of ['update', 'set', 'where', 'andWhere', 'returning', 'setLock']) {
          qb[method] = jest.fn().mockReturnValue(qb);
        }
        qb.getOne = jest.fn().mockResolvedValue(options.parent ?? { id: 'w1', version: 3 });
        qb.execute = jest.fn().mockResolvedValue({ raw: options.raw });
        return qb;
      }),
      increment: jest.fn(),
    });

    const withEm = (em: Record<string, Mock>) =>
      makeRepository({
        dataSource: { transaction: jest.fn((cb: (m: unknown) => unknown) => cb(em)) },
      });

    it('should distinguish an unknown hold from an already-released one', async () => {
      const em = releaseEm({ existing: null, raw: [] });
      const { repo } = withEm(em);

      await expect(
        repo.releaseHold({ holdId: 'h-unknown', releasedAt: new Date() })
      ).rejects.toBeInstanceOf(FulfillmentHoldNotFoundError);
    });

    it('should report an already-released hold as its own fact', async () => {
      const releasedAt = new Date('2026-08-01T00:00:00Z');
      const em = releaseEm({
        existing: { id: 'h1', fulfillmentWorkId: 'w1', releasedAt },
        raw: [],
      });
      const { repo } = withEm(em);

      await expect(
        repo.releaseHold({ holdId: 'h1', releasedAt: new Date() })
      ).rejects.toBeInstanceOf(FulfillmentHoldAlreadyReleasedError);
    });

    it('should return the stamped row from the same statement that released it', async () => {
      const em = releaseEm({
        existing: { id: 'h1', fulfillmentWorkId: 'w1', releasedAt: null },
        raw: [
          {
            id: 'h1',
            fulfillmentWorkId: 'w1',
            reason: 'manual-review',
            note: null,
            placedByUserId: 'u1',
            placedByService: null,
            placedAt: new Date(),
            releasedAt: new Date(),
            releasedByUserId: 'u2',
            releaseNote: null,
          },
        ],
      });
      const { repo } = withEm(em);

      const released = await repo.releaseHold({ holdId: 'h1', releasedAt: new Date() });

      // The RETURNING row, not a read-after-write: `affected` and the returned
      // row cannot disagree.
      expect(released.id).toBe('h1');
      expect(released.releasedByUserId).toBe('u2');
    });

    it('should refuse a stale token BEFORE releasing anything (#2406)', async () => {
      // The guard exists so a second operator cannot release a hold the first
      // one already acted on. Asserted by its EFFECT — nothing was released and
      // no version was bumped — not merely by the throw.
      const em = releaseEm({
        existing: { id: 'h1', fulfillmentWorkId: 'w1', releasedAt: null },
        raw: [],
        parent: { id: 'w1', version: 9 },
      });
      const { repo } = withEm(em);

      await expect(
        repo.releaseHold({ holdId: 'h1', releasedAt: new Date(), expectedVersion: 3 })
      ).rejects.toBeInstanceOf(FulfillmentWorkVersionMismatchError);
      expect(em.increment).not.toHaveBeenCalled();
    });

    it('should take the token lock only when a token was supplied (#2406)', async () => {
      // An unguarded caller pays no lock — the pre-#2406 behaviour is preserved
      // byte-for-byte, which is what makes `expectedVersion` additive.
      const em = releaseEm({
        existing: { id: 'h1', fulfillmentWorkId: 'w1', releasedAt: null },
        raw: [{ id: 'h1', fulfillmentWorkId: 'w1', reason: 'manual-review', placedAt: new Date() }],
      });
      const { repo } = withEm(em);

      await repo.releaseHold({ holdId: 'h1', releasedAt: new Date() });

      const builder = em.createQueryBuilder.mock.results[0].value as { setLock: Mock };
      expect(builder.setLock).not.toHaveBeenCalled();
    });
  });
});

/**
 * Format-drift guard for the leaf's local id minter.
 *
 * The repository cannot value-import `formatInternalId` (a sibling-context
 * VALUE import, forbidden from a registered zero-sibling-edge leaf), so it
 * reproduces the format. **A spec file CAN import it** — the leaf walker
 * excludes `*.spec.ts` — which is what makes this duplication safe rather than
 * merely convenient: if `formatInternalId` ever changes shape, this fails.
 */
describe('fulfillment work id format', () => {
  it('should match what formatInternalId would have produced', async () => {
    const reference = formatInternalId('FulfillmentWork');
    expect(reference).toMatch(/^ol_fulfillmentwork_[0-9a-f]{32}$/);

    const save = jest
      .fn()
      .mockImplementation((_entity: unknown, payload: unknown) => Promise.resolve(payload));
    const repo = new FulfillmentWorkRepository(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { transaction: (cb: (m: unknown) => unknown) => cb({ save }) } as never
    );

    const work = await repo.create({
      orderId: 'ol_order_1',
      locationId: null,
      deliveryMethod: null,
      assignedConnectionId: null,
      lines: [],
    });

    // Compared on EVERY axis the two could differ by, not just the prefix. A
    // prefix-only check would pass if `formatInternalId` switched to a
    // dash-bearing uuid, a base36 body, or a different length — i.e. exactly the
    // drifts this guard exists to catch.
    const shapeOf = (id: string): string =>
      id
        .split('_')
        .map((segment, index) => (index < 2 ? segment : segment.replace(/[0-9a-f]/g, 'h')))
        .join('_');

    expect(work.id).toMatch(/^ol_fulfillmentwork_[0-9a-f]{32}$/);
    expect(shapeOf(work.id)).toBe(shapeOf(reference));
    expect(work.id).toHaveLength(reference.length);
    expect(work.id.split('_')).toHaveLength(reference.split('_').length);
  });
});
