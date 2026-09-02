/**
 * Reservation Repository Unit Tests (#2343)
 *
 * These cover what a mocked driver CAN prove: the delta arithmetic, the
 * mandatory `inventoryItemId` claim ordering (the deadlock guarantee), the
 * empty-array short-circuit, and the translation of each zero-row branch into
 * its named domain error.
 *
 * They deliberately do NOT claim to prove the guards. A `WHERE` predicate is not
 * exercised by a mock that decides for itself how many rows it returns — that is
 * `apps/api/test/integration/reservations-ledger.int-spec.ts`'s job, against
 * real Postgres and real concurrency.
 *
 * @module libs/core/src/inventory/infrastructure/persistence/repositories
 */
import { QueryFailedError } from 'typeorm';
import { ReservationRepository } from './reservation.repository';
import { InsufficientAvailabilityError } from '../../../domain/exceptions/insufficient-availability.error';
import { ReservationLedgerConstraintError } from '../../../domain/exceptions/reservation-ledger-constraint.error';
import { ReservationNotHeldError } from '../../../domain/exceptions/reservation-not-held.error';
import { ReservationPositionUnavailableError } from '../../../domain/exceptions/reservation-position-unavailable.error';
import type { ReservationClaimInput } from '../../../domain/types/reservation.types';

const EXPIRES_AT = new Date('2026-09-01T00:00:00.000Z');

function reservationRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'res-1',
    orderRecordId: 'ol_order_1',
    orderLineId: 'line-1',
    inventoryItemId: 'inv-b',
    quantity: 2,
    status: 'held',
    expiresAt: EXPIRES_AT,
    atpEffect: 'published',
    closedAt: null,
    createdAt: EXPIRES_AT,
    updatedAt: EXPIRES_AT,
    ...overrides,
  };
}

function claim(overrides: Partial<ReservationClaimInput> = {}): ReservationClaimInput {
  return {
    orderRecordId: 'ol_order_1',
    orderLineId: 'line-1',
    inventoryItemId: 'inv-b',
    quantity: 2,
    atpEffect: 'published',
    expiresAt: EXPIRES_AT,
    ...overrides,
  };
}

/**
 * A scripted `EntityManager.query`: each call shifts one reply off the queue and
 * records the SQL, so a test asserts over the STATEMENTS issued rather than over
 * a fake's internal state.
 */
function createHarness(replies: unknown[][]) {
  const statements: { sql: string; params: unknown[] }[] = [];
  const query = jest.fn((sql: string, params: unknown[]) => {
    statements.push({ sql, params });
    return Promise.resolve(replies.shift() ?? []);
  });
  const manager = { query };
  const transaction = jest.fn((fn: (m: typeof manager) => Promise<unknown>) => fn(manager));
  const dataSource = { transaction };
  const ormRepository = { findOne: jest.fn(), find: jest.fn() };
  return {
    statements,
    query,
    transaction,
    ormRepository,
    dataSource,
    repository: new ReservationRepository(
      ormRepository as unknown as ConstructorParameters<typeof ReservationRepository>[0],
      dataSource as unknown as ConstructorParameters<typeof ReservationRepository>[1],
    ),
  };
}

describe('ReservationRepository', () => {
  describe('claimHeld', () => {
    it('should return an empty result and open no transaction when given no claims', async () => {
      const h = createHarness([]);

      await expect(h.repository.claimHeld([])).resolves.toEqual([]);

      expect(h.transaction).not.toHaveBeenCalled();
    });

    it('should sort claims by inventoryItemId before issuing any statement', async () => {
      // The deadlock guarantee (§ 6I): two multi-line orders touching the same
      // positions in opposite INPUT order must issue statements in the same
      // order. Asserted on the statements, not on an internal sorted array.
      const h = createHarness([
        [reservationRow({ id: 'r-a', inventoryItemId: 'inv-a' })],
        [{ remainingAtp: 5 }],
        [reservationRow({ id: 'r-a', inventoryItemId: 'inv-a' })],
        [reservationRow({ id: 'r-c', inventoryItemId: 'inv-c' })],
        [{ remainingAtp: 7 }],
        [reservationRow({ id: 'r-c', inventoryItemId: 'inv-c' })],
      ]);

      await h.repository.claimHeld([
        claim({ inventoryItemId: 'inv-c', orderLineId: 'line-2' }),
        claim({ inventoryItemId: 'inv-a', orderLineId: 'line-1' }),
      ]);

      const touched = h.statements
        .filter((s) => s.sql.includes('INSERT INTO "reservations"'))
        .map((s) => s.params[2]);
      expect(touched).toEqual(['inv-a', 'inv-c']);
    });

    it('should apply the full quantity as the delta when the row is newly inserted', async () => {
      const h = createHarness([
        [reservationRow({ quantity: 3 })],
        [{ remainingAtp: 4 }],
        [reservationRow({ quantity: 3 })],
      ]);

      const [outcome] = await h.repository.claimHeld([claim({ quantity: 3 })]);

      expect(outcome.previousQuantity).toBe(0);
      expect(outcome.deltaApplied).toBe(3);
      expect(outcome.remainingAtp).toBe(4);
      const add = h.statements.find((s) => s.sql.includes('+ $3'));
      // [inventoryItemId, reservationId (excluded from the sum), delta,
      //  headroom required, this claim's own contribution to the published sum]
      expect(add?.params).toEqual(['inv-b', 'res-1', 3, 3, 3]);
    });

    it('should subtract only PUBLISHED holds in the guard, and exclude its own row', async () => {
      // The #2628-review scoping, asserted on the STATEMENT because a mocked
      // driver cannot exercise a `WHERE`. Two properties, both of which broke
      // something real when absent:
      //
      //  - `atpEffect = 'published'`: guarding on the raw `olReservedQuantity`
      //    counter lets a `diagnostic` hold refuse a reservation, and on the
      //    default `omp_fulfilled` topology those accumulate for the life of the
      //    install.
      //  - `"id" <> $2`: `claimOne` writes the ledger row BEFORE it moves the
      //    counter, so without the exclusion the guard tests the claim against
      //    its own units.
      const h = createHarness([
        [reservationRow({ quantity: 3 })],
        [{ remainingAtp: 4 }],
        [reservationRow({ quantity: 3 })],
      ]);

      await h.repository.claimHeld([claim({ quantity: 3 })]);

      const add = h.statements.find((s) => s.sql.includes('+ $3'));
      expect(add?.sql).toContain(`"r_pub"."atpEffect" = 'published'`);
      expect(add?.sql).toContain(`"r_pub"."id" <> $2`);
      expect(add?.sql).not.toContain('- "olReservedQuantity" >=');
    });

    it('should contribute nothing to the published sum for a diagnostic claim', async () => {
      // A `diagnostic` hold promises nothing, so granting one must leave the
      // reported published ATP exactly where it was. The counter still moves by
      // the full delta — it is the denormalised total of BOTH stamps.
      const h = createHarness([
        [reservationRow({ quantity: 3, atpEffect: 'diagnostic' })],
        [{ remainingAtp: 10 }],
        [reservationRow({ quantity: 3, atpEffect: 'diagnostic' })],
      ]);

      await h.repository.claimHeld([claim({ quantity: 3, atpEffect: 'diagnostic' })]);

      const add = h.statements.find((s) => s.sql.includes('+ $3'));
      // …, delta = 3 (the counter moves), …, published contribution = 0.
      expect(add?.params).toEqual(['inv-b', 'res-1', 3, 3, 0]);
    });

    it('should grant a repeated identical claim and move the counter not at all', async () => {
      // ADR-061 amendment 2: an existing held row for the same key IS a success.
      // Without this, an ingestion crash after `claimHeld` would wedge the order
      // forever behind a false "insufficient stock".
      const h = createHarness([
        [], // INSERT ... ON CONFLICT DO NOTHING → no row
        [reservationRow({ quantity: 2 })], // recover the winner
      ]);

      const [outcome] = await h.repository.claimHeld([claim({ quantity: 2 })]);

      expect(outcome.previousQuantity).toBe(2);
      expect(outcome.deltaApplied).toBe(0);
      expect(outcome.remainingAtp).toBeNull();
      expect(h.statements.some((s) => s.sql.includes('"inventory_items"'))).toBe(false);
    });

    it('should widen by the delta only when an existing claim is amended up', async () => {
      const h = createHarness([
        [],
        [reservationRow({ quantity: 2 })],
        [{ remainingAtp: 1 }],
        [reservationRow({ quantity: 5 })],
      ]);

      const [outcome] = await h.repository.claimHeld([claim({ quantity: 5 })]);

      expect(outcome.deltaApplied).toBe(3);
      const add = h.statements.find((s) => s.sql.includes('+ $3'));
      // The DESIRED total (5) is what the guard asks headroom for, not the
      // delta — the exact `atpEffect`-scoping of the pre-#2628 predicate, which
      // compared the delta against a subtrahend that still contained this row's
      // previous quantity.
      expect(add?.params).toEqual(['inv-b', 'res-1', 3, 5, 5]);
    });

    it('should release the difference without a guard when a claim is amended down', async () => {
      // A narrowing gives units back, so it can never fail on availability —
      // guarding it would refuse a shrink on a position that is already short.
      const h = createHarness([
        [],
        [reservationRow({ quantity: 5 })],
        [],
        [reservationRow({ quantity: 2 })],
      ]);

      const [outcome] = await h.repository.claimHeld([claim({ quantity: 2 })]);

      expect(outcome.deltaApplied).toBe(-3);
      expect(outcome.remainingAtp).toBeNull();
      const decrement = h.statements.find((s) => s.sql.includes('GREATEST(0'));
      expect(decrement?.params).toEqual(['inv-b', 3]);
      expect(h.statements.some((s) => s.sql.includes('+ $2'))).toBe(false);
    });

    it('should throw InsufficientAvailabilityError when the position is live but short', async () => {
      const h = createHarness([
        [reservationRow({ quantity: 9 })],
        [], // guarded add matched nothing
        [{ isStale: false, atp: 4 }], // discriminating probe
      ]);

      await expect(h.repository.claimHeld([claim({ quantity: 9 })])).rejects.toThrow(
        InsufficientAvailabilityError,
      );
    });

    it('should throw ReservationPositionUnavailableError with reason stale for a stale position', async () => {
      const h = createHarness([
        [reservationRow()],
        [],
        [{ isStale: true, atp: 100 }],
      ]);

      const rejection = await h.repository.claimHeld([claim()]).catch((e: unknown) => e);

      expect(rejection).toBeInstanceOf(ReservationPositionUnavailableError);
      expect(rejection).toMatchObject({ reason: 'stale' });
    });

    it('should throw ReservationPositionUnavailableError with reason missing when no position exists', async () => {
      const h = createHarness([[reservationRow()], [], []]);

      const rejection = await h.repository.claimHeld([claim()]).catch((e: unknown) => e);

      expect(rejection).toBeInstanceOf(ReservationPositionUnavailableError);
      expect(rejection).toMatchObject({ reason: 'missing' });
    });

    it('should reject a non-positive quantity before opening a transaction', async () => {
      const h = createHarness([]);

      await expect(h.repository.claimHeld([claim({ quantity: 0 })])).rejects.toThrow(RangeError);

      expect(h.transaction).not.toHaveBeenCalled();
    });

    it('should not mutate the caller-supplied claims array while sorting', async () => {
      const h = createHarness([
        [reservationRow({ inventoryItemId: 'inv-a' })],
        [{ remainingAtp: 1 }],
        [reservationRow({ inventoryItemId: 'inv-a' })],
        [reservationRow({ inventoryItemId: 'inv-c' })],
        [{ remainingAtp: 1 }],
        [reservationRow({ inventoryItemId: 'inv-c' })],
      ]);
      const claims = [
        claim({ inventoryItemId: 'inv-c', orderLineId: 'line-2' }),
        claim({ inventoryItemId: 'inv-a' }),
      ];

      await h.repository.claimHeld(claims);

      expect(claims.map((c) => c.inventoryItemId)).toEqual(['inv-c', 'inv-a']);
    });
  });

  describe('releaseHeld', () => {
    it('should terminalise the ledger row and decrement the counter by its quantity', async () => {
      const h = createHarness([[reservationRow({ quantity: 4 })], []]);

      const released = await h.repository.releaseHeld({
        orderRecordId: 'ol_order_1',
        orderLineId: 'line-1',
        inventoryItemId: 'inv-b',
        terminalStatus: 'consumed',
      });

      expect(released.quantity).toBe(4);
      expect(h.statements[0].params[3]).toBe('consumed');
      expect(h.statements[1].sql).toContain('GREATEST(0');
      expect(h.statements[1].params).toEqual(['inv-b', 4]);
    });

    it('should throw ReservationNotHeldError and touch no counter when nothing is held', async () => {
      // A double release that quietly succeeded is indistinguishable from a real
      // one, and its second decrement is exactly how the counter drifts below
      // the ledger.
      const h = createHarness([[]]);

      await expect(
        h.repository.releaseHeld({
          orderRecordId: 'ol_order_1',
          orderLineId: 'line-1',
          inventoryItemId: 'inv-b',
          terminalStatus: 'released',
        }),
      ).rejects.toThrow(ReservationNotHeldError);

      expect(h.statements).toHaveLength(1);
    });
  });

  describe('driver reply shape', () => {
    // The Wave-1c production defect, pinned: node-postgres surfaces a
    // data-modifying statement with RETURNING through TypeORM's raw query as
    // `[rows, affectedCount]`, NOT as the row list. A spec that only ever mocks
    // the plain-array shape passes while the production path reads an integer
    // where it expected a row — which is how a count became a constant once
    // already. Both shapes are asserted here, on the same claim.
    it('should read rows out of a [rows, affectedCount] tuple exactly as it does a plain array', async () => {
      const tuple = createHarness([
        [[reservationRow({ quantity: 3 })], 1],
        [[{ remainingAtp: 4 }], 1],
        [[reservationRow({ quantity: 3 })], 1],
      ]);
      const plain = createHarness([
        [reservationRow({ quantity: 3 })],
        [{ remainingAtp: 4 }],
        [reservationRow({ quantity: 3 })],
      ]);

      const fromTuple = await tuple.repository.claimHeld([claim({ quantity: 3 })]);
      const fromPlain = await plain.repository.claimHeld([claim({ quantity: 3 })]);

      expect(fromTuple).toEqual(fromPlain);
      expect(fromTuple[0]).toMatchObject({ deltaApplied: 3, remainingAtp: 4 });
      expect(fromTuple[0].reservation.quantity).toBe(3);
    });

    it('should raise InsufficientAvailabilityError when the guard matches nothing in tuple form', async () => {
      // A zero-row guarded UPDATE arrives as `[[], 0]`. Read naively, the outer
      // array is truthy and length 2 — i.e. "two rows claimed" — so this is the
      // exact shape that would turn a refusal into a silent oversell.
      const h = createHarness([
        [[reservationRow({ quantity: 3 })], 1],
        [[], 0],
        [[{ isStale: false, atp: 1 }], 1],
      ]);

      await expect(h.repository.claimHeld([claim({ quantity: 3 })])).rejects.toThrow(
        InsufficientAvailabilityError,
      );
    });
  });

  describe('error translation', () => {
    it('should convert a QueryFailedError into a named ReservationLedgerConstraintError', async () => {
      const h = createHarness([]);
      const failure = new QueryFailedError('sql', [], new Error('boom'));
      (failure as unknown as { driverError: unknown }).driverError = {
        constraint: 'CHK_inventory_items_ol_reserved_nonneg',
      };
      h.transaction.mockRejectedValueOnce(failure);

      await expect(h.repository.claimHeld([claim()])).rejects.toMatchObject({
        name: 'ReservationLedgerConstraintError',
        constraint: 'CHK_inventory_items_ol_reserved_nonneg',
      });
    });

    it('should let a named domain error pass through untranslated', async () => {
      const h = createHarness([]);
      const domainError = new ReservationNotHeldError('o', 'l', 'i');
      h.transaction.mockRejectedValueOnce(domainError);

      const rejection = await h.repository.claimHeld([claim()]).catch((e: unknown) => e);

      expect(rejection).toBeInstanceOf(ReservationNotHeldError);
      expect(rejection).not.toBeInstanceOf(ReservationLedgerConstraintError);
    });
  });
});
