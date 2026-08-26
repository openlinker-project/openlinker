/**
 * Order Holds Integration Test (#2338, DESIGN §6.3 / REVIEW §3 H9)
 *
 * Verifies `order_holds` and `OrderHoldRepositoryPort` against real Postgres
 * (Testcontainers). Everything asserted here is either a DATABASE-level
 * guarantee a mock cannot express, or the translation of one into a domain
 * error — and each is part of the contract #2339–#2342 build on.
 *
 * **The subject is the PORT, not the table.** The issue's acceptance criterion
 * is that "no TypeORM error type escapes the port", which raw SQL cannot prove;
 * the sibling `order-changes-schema.int-spec.ts` asserts its schema with raw SQL
 * and never touches its repository, so it is deliberately not the model here.
 *
 * **The port is resolved from the container by its Symbol token**, which is
 * what `OrdersModule` importing and re-exporting `OrderHoldsModule` buys.
 * Constructing `OrderHoldRepository`
 * directly would need a deep import of `@openlinker/core/orders/infrastructure/…`,
 * which `.eslintrc.js` bans for `apps/**` (#591). `OrderHoldOrmEntity` is still
 * taken from the `orm-entities` sub-barrel, but only for the raw-SQL fixtures
 * that exercise the actor CHECK — the port's typed input cannot express those
 * violations.
 *
 * **The harness builds its schema by `synchronize`, not by migration**, which is
 * why the partial unique index and the actor CHECK are declared on
 * `OrderHoldOrmEntity` under the same names and predicates as the migration —
 * otherwise these assertions would hold against only one of the two schemas.
 *
 * @module apps/api/test/integration/orders
 */
import {
  HoldAlreadyReleasedError,
  OrderAlreadyOnHoldError,
  OrderHold,
  OrderHoldNotFoundError,
  ORDER_HOLD_REPOSITORY_TOKEN,
} from '@openlinker/core/orders';
import { QueryFailedError } from 'typeorm';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from '../setup';

describe('Order Holds Integration (#2338)', () => {
  let harness: IntegrationTestHarness;
  // Typed structurally rather than by the port interface, which is
  // intra-context and deliberately not exported from the barrel.
  let repository: {
    placeIfNoneOpen(input: {
      internalOrderId: string;
      reason: 'fraud-review';
      note: string | null;
      placedBy: { kind: 'user'; userId: string };
      placedAt: Date;
    }): Promise<OrderHold>;
    releaseHeld(input: {
      holdId: string;
      releasedAt: Date;
      releaseNote: string | null;
      releasedByUserId: string | null;
    }): Promise<OrderHold>;
    findOpenByOrder(internalOrderId: string): Promise<OrderHold | null>;
    findOpenByOrders(internalOrderIds: string[]): Promise<OrderHold[]>;
    listByOrder(internalOrderId: string): Promise<OrderHold[]>;
    listOpenPlacedBefore(before: Date, limit: number): Promise<OrderHold[]>;
    listOpenHolds(limit: number, offset: number): Promise<OrderHold[]>;
  };

  const ORDER_A = 'ol_order_aaa';
  const ORDER_B = 'ol_order_bbb';

  const at = (iso: string): Date => new Date(iso);
  const PLACED_AT = at('2026-08-01T10:00:00.000Z');

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  beforeEach(() => {
    repository = harness
      .getApp()
      .get(ORDER_HOLD_REPOSITORY_TOKEN, { strict: false });
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  const query = async <T = unknown>(
    sql: string,
    params: unknown[] = []
  ): Promise<T[]> => (await harness.getDataSource().query(sql, params)) as T[];

  const place = (
    internalOrderId = ORDER_A,
    placedAt = PLACED_AT
  ): Promise<OrderHold> =>
    repository.placeIfNoneOpen({
      internalOrderId,
      reason: 'fraud-review',
      note: 'risk check outstanding',
      placedBy: { kind: 'user', userId: 'user-1' },
      placedAt,
    });

  describe('placeIfNoneOpen', () => {
    it('should insert one open hold and default its release columns to null', async () => {
      const hold = await place();

      expect(hold.isOpen()).toBe(true);
      expect(hold.reason).toBe('fraud-review');
      expect(hold.releasedAt).toBeNull();
      expect(hold.releasedByUserId).toBeNull();
      expect(hold.releaseNote).toBeNull();
    });

    it('should insert one row and raise OrderAlreadyOnHoldError when called twice for one order', async () => {
      const first = await place();

      const error = await place().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(OrderAlreadyOnHoldError);
      expect((error as OrderAlreadyOnHoldError).openHoldId).toBe(first.id);

      const rows = await query<{ count: string }>(
        `SELECT count(*)::text AS count FROM "order_holds" WHERE "internalOrderId" = $1`,
        [ORDER_A]
      );
      expect(rows[0].count).toBe('1');
    });

    it('should not let a TypeORM error type escape the port on a conflict', async () => {
      // The acceptance criterion, asserted positively: the caller sees a domain
      // error and nothing of the driver.
      await place();

      const error = await place().catch((e: unknown) => e);

      expect(error).not.toBeInstanceOf(QueryFailedError);
      expect((error as Error).name).toBe('OrderAlreadyOnHoldError');
    });

    it('should not serialize two different orders against each other', async () => {
      await place(ORDER_A);
      const other = await place(ORDER_B);

      expect(other.isOpen()).toBe(true);
      expect(other.internalOrderId).toBe(ORDER_B);
    });

    it('should free the slot on release, so an order can be held again', async () => {
      // The property that makes the unique index PARTIAL rather than total: a
      // total index would leave the order permanently unholdable.
      const first = await place();
      await repository.releaseHeld({
        holdId: first.id,
        releasedAt: at('2026-08-02T10:00:00.000Z'),
        releaseNote: 'cleared',
        releasedByUserId: 'user-2',
      });

      const second = await place();

      expect(second.id).not.toBe(first.id);
      expect(second.isOpen()).toBe(true);
    });
  });

  describe('releaseHeld', () => {
    it('should stamp once and raise HoldAlreadyReleasedError when called twice', async () => {
      const hold = await place();
      const releasedAt = at('2026-08-02T10:00:00.000Z');
      const release = {
        holdId: hold.id,
        releasedAt,
        releaseNote: 'cleared',
        releasedByUserId: 'user-2',
      };

      const released = await repository.releaseHeld(release);
      expect(released.isOpen()).toBe(false);
      expect(released.releaseNote).toBe('cleared');

      const error = await repository.releaseHeld(release).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HoldAlreadyReleasedError);
      expect(error).not.toBeInstanceOf(QueryFailedError);
      // The stamp did not move — the second call wrote nothing.
      expect((error as HoldAlreadyReleasedError).releasedAt).toEqual(releasedAt);
    });

    it('should raise OrderHoldNotFoundError for an unknown id, distinctly from an already-released one', async () => {
      const error = await repository
        .releaseHeld({
          holdId: '00000000-0000-4000-8000-000000000000',
          releasedAt: at('2026-08-02T10:00:00.000Z'),
          releaseNote: null,
          releasedByUserId: 'user-2',
        })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(OrderHoldNotFoundError);
      expect(error).not.toBeInstanceOf(HoldAlreadyReleasedError);
    });
  });

  describe('CHK_order_holds_actor', () => {
    // Raw SQL here, deliberately: the port's typed input cannot express these
    // violations, so the DB constraint is the only thing standing between an
    // out-of-band writer and an unattributable audit row.
    const insertWithActors = (
      placedByUserId: string | null,
      placedByService: string | null
    ): Promise<unknown[]> =>
      query(
        `INSERT INTO "order_holds"
           ("internalOrderId", "reason", "placedByUserId", "placedByService", "placedAt")
         VALUES ($1, 'operator', $2, $3, now())`,
        [ORDER_A, placedByUserId, placedByService]
      );

    it('should reject a row naming no actor', async () => {
      await expect(insertWithActors(null, null)).rejects.toThrow();
    });

    it('should reject a row naming both a human and a service', async () => {
      await expect(insertWithActors('user-1', 'risk-engine')).rejects.toThrow();
    });

    it('should accept a service-placed row', async () => {
      await expect(insertWithActors(null, 'risk-engine')).resolves.toBeDefined();
    });
  });

  describe('reads', () => {
    it('should find the open hold for an order and nothing once released', async () => {
      const hold = await place();
      await expect(repository.findOpenByOrder(ORDER_A)).resolves.toMatchObject({
        id: hold.id,
      });

      await repository.releaseHeld({
        holdId: hold.id,
        releasedAt: at('2026-08-02T10:00:00.000Z'),
        releaseNote: null,
        releasedByUserId: 'user-2',
      });

      await expect(repository.findOpenByOrder(ORDER_A)).resolves.toBeNull();
    });

    it('should batch open holds across orders and omit released ones', async () => {
      const a = await place(ORDER_A);
      await place(ORDER_B);
      await repository.releaseHeld({
        holdId: a.id,
        releasedAt: at('2026-08-02T10:00:00.000Z'),
        releaseNote: null,
        releasedByUserId: 'user-2',
      });

      const open = await repository.findOpenByOrders([ORDER_A, ORDER_B]);

      expect(open.map((h) => h.internalOrderId)).toEqual([ORDER_B]);
    });

    it('should list an order history newest-first, including released holds', async () => {
      const first = await place(ORDER_A, at('2026-08-01T10:00:00.000Z'));
      await repository.releaseHeld({
        holdId: first.id,
        releasedAt: at('2026-08-02T10:00:00.000Z'),
        releaseNote: null,
        releasedByUserId: 'user-2',
      });
      const second = await place(ORDER_A, at('2026-08-03T10:00:00.000Z'));

      const history = await repository.listByOrder(ORDER_A);

      expect(history.map((h) => h.id)).toEqual([second.id, first.id]);
      expect(history[1].isOpen()).toBe(false);
    });

    it('should list open holds placed before a threshold, excluding newer and released ones', async () => {
      const old = await place(ORDER_A, at('2026-08-01T10:00:00.000Z'));
      await place(ORDER_B, at('2026-08-20T10:00:00.000Z'));

      const stale = await repository.listOpenPlacedBefore(
        at('2026-08-10T00:00:00.000Z'),
        10
      );

      expect(stale.map((h) => h.id)).toEqual([old.id]);
    });

    it('should page open holds for the reconcile sweep', async () => {
      await place(ORDER_A);
      await place(ORDER_B);

      const page = await repository.listOpenHolds(1, 0);
      const next = await repository.listOpenHolds(1, 1);

      expect(page).toHaveLength(1);
      expect(next).toHaveLength(1);
      expect(next[0].id).not.toBe(page[0].id);
    });
  });
});
