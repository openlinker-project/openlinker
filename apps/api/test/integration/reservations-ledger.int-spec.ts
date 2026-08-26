/**
 * Reservation Ledger Integration Test (#2343, ANALYSIS-1032 § 6I, ADR-061)
 *
 * The concurrency matrix. Every operation on `ReservationRepositoryPort` is a
 * primitive whose failure mode is an **oversell**, and a `WHERE` predicate is
 * not exercised by a mocked repository that decides for itself how many rows it
 * returns — only real Postgres can prove:
 *
 * - Two concurrent claims for a position with stock for ONE succeed exactly
 *   once; the loser raises `InsufficientAvailabilityError`.
 * - Two concurrent MULTI-LINE claims submitted in opposite input order do not
 *   deadlock (the `inventoryItemId` sort is what buys this).
 * - `olReservedQuantity` can never go negative — the guard refuses it, and the
 *   `CHECK` refuses it even when the guard is bypassed entirely.
 * - **No `CHECK` forbids `olReserved > available`.** This asserts an ABSENCE
 *   deliberately: a master lowering availability below a committed reservation
 *   set is a fact to surface (`W2-12`), not a constraint violation that would
 *   make the *sync* fail.
 * - A release racing a second release decrements exactly once.
 * - No TypeORM error escapes the port.
 *
 * **Concurrency is exercised on separate connections**, not by `Promise.all`
 * over one — the driver would serialise the latter and the test would prove
 * nothing about locking.
 *
 * NOTE the harness builds its schema by `synchronize`, not by the migrations,
 * matching its #2314 / #2319 / #2320 siblings. Every constraint asserted here is
 * therefore declared on the ORM entity under the same name the migration uses.
 *
 * @module apps/api/test/integration
 */
import { DataSource } from 'typeorm';
import {
  ProductOrmEntity,
  ProductVariantOrmEntity,
} from '@openlinker/core/products/orm-entities';
import { InventoryItemOrmEntity } from '@openlinker/core/inventory/orm-entities';
import {
  InsufficientAvailabilityError,
  RESERVATION_REPOSITORY_TOKEN,
  RESERVATION_SERVICE_TOKEN,
  type IReservationService,
  ReservationNotHeldError,
  ReservationPositionUnavailableError,
  type ReleaseReservationInput,
  type Reservation,
  type ReservationClaimInput,
  type ReservationClaimOutcome,
  type ReservationKey,
} from '@openlinker/core/inventory';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

/**
 * The slice of `ReservationRepositoryPort` this spec exercises, declared locally.
 *
 * The port itself is intentionally NOT importable from `@openlinker/core/inventory`:
 * a `*RepositoryPort` is an intra-context contract and
 * `scripts/check-cross-context-imports.mjs` denies the shape (see
 * `docs/architecture-overview.md § Cross-context dependencies in core`). That
 * rule is doing its job here — nothing in `apps/api` should bind to a repository
 * contract — and this spec is the one legitimate exception, because its SUBJECT
 * is the guarded SQL, which only real Postgres can prove. Binding to the shape
 * it calls rather than allow-listing the import keeps the deny rule intact.
 *
 * Every argument and return type is still the real one, imported from the
 * barrel, so a signature change here fails to compile rather than drifting.
 */
interface ReservationLedger {
  claimHeld(claims: readonly ReservationClaimInput[]): Promise<readonly ReservationClaimOutcome[]>;
  releaseHeld(input: ReleaseReservationInput): Promise<Reservation>;
  findHeld(key: ReservationKey): Promise<Reservation | null>;
  listHeldByOrderRecordId(orderRecordId: string): Promise<readonly Reservation[]>;
}

const EXPIRES_AT = new Date('2027-01-01T00:00:00.000Z');

interface SeededPosition {
  inventoryItemId: string;
  productId: string;
  variantId: string;
}

async function seedPosition(
  dataSource: DataSource,
  availableQuantity: number,
  options: { isStale?: boolean } = {},
): Promise<SeededPosition> {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  const productId = `ol_product_res_${suffix}`;
  const variantId = `ol_variant_res_${suffix}`;
  const inventoryItemId = `ol_inventoryitem_res_${suffix}`;

  const productRepo = dataSource.getRepository(ProductOrmEntity);
  await productRepo.save(
    productRepo.create({ id: productId, name: `Res Test ${suffix}`, sku: null, price: null }),
  );

  const variantRepo = dataSource.getRepository(ProductVariantOrmEntity);
  await variantRepo.save(
    variantRepo.create({ id: variantId, productId, sku: null, attributes: null, ean: null, gtin: null }),
  );

  const itemRepo = dataSource.getRepository(InventoryItemOrmEntity);
  await itemRepo.save(
    itemRepo.create({
      id: inventoryItemId,
      productId,
      productVariantId: variantId,
      availableQuantity,
      reservedQuantity: 0,
      olReservedQuantity: 0,
      locationId: null,
      sourceConnectionId: 'conn-res-test',
      isStale: options.isStale ?? false,
    }),
  );

  return { inventoryItemId, productId, variantId };
}

async function readCounter(dataSource: DataSource, inventoryItemId: string): Promise<number> {
  const rows = (await dataSource.query(
    `SELECT "olReservedQuantity" FROM "inventory_items" WHERE "id" = $1`,
    [inventoryItemId],
  )) as { olReservedQuantity: number | string }[];
  return Number(rows[0]?.olReservedQuantity ?? -1);
}

function claim(overrides: Partial<ReservationClaimInput> & { inventoryItemId: string }): ReservationClaimInput {
  return {
    orderRecordId: 'ol_order_res_1',
    orderLineId: 'line-1',
    quantity: 1,
    atpEffect: 'published',
    expiresAt: EXPIRES_AT,
    ...overrides,
  };
}

describe('Reservation ledger (#2343)', () => {
  let harness: IntegrationTestHarness;
  let dataSource: DataSource;
  let reservations: ReservationLedger;

  beforeAll(async () => {
    harness = await getTestHarness();
    dataSource = harness.getDataSource();
    reservations = harness.getApp().get<ReservationLedger>(RESERVATION_REPOSITORY_TOKEN);
  }, 120_000);

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  describe('the guarded claim', () => {
    it('should grant exactly one of two concurrent claims when stock covers only one', async () => {
      // THE motivating case. Both callers see the same pre-state; only the guard
      // can decide, and it must decide once.
      const position = await seedPosition(dataSource, 1);

      const results = await Promise.allSettled([
        reservations.claimHeld([
          claim({ inventoryItemId: position.inventoryItemId, orderRecordId: 'ol_order_A' }),
        ]),
        reservations.claimHeld([
          claim({ inventoryItemId: position.inventoryItemId, orderRecordId: 'ol_order_B' }),
        ]),
      ]);

      const granted = results.filter((r) => r.status === 'fulfilled');
      const refused = results.filter((r) => r.status === 'rejected');
      expect(granted).toHaveLength(1);
      expect(refused).toHaveLength(1);

      const reason = (refused[0] as PromiseRejectedResult).reason as unknown;
      expect(reason).toBeInstanceOf(InsufficientAvailabilityError);
      expect(reason).toMatchObject({ requestedQuantity: 1, availableQuantity: 0 });

      expect(await readCounter(dataSource, position.inventoryItemId)).toBe(1);
    });

    it('should not deadlock when two multi-line claims arrive in opposite order', async () => {
      // Without the `inventoryItemId` sort these two transactions grab the same
      // two rows in opposite order and one is killed by the deadlock detector.
      const first = await seedPosition(dataSource, 10);
      const second = await seedPosition(dataSource, 10);

      const forwards = reservations.claimHeld([
        claim({ inventoryItemId: first.inventoryItemId, orderRecordId: 'ol_order_A', orderLineId: 'l1' }),
        claim({ inventoryItemId: second.inventoryItemId, orderRecordId: 'ol_order_A', orderLineId: 'l2' }),
      ]);
      const backwards = reservations.claimHeld([
        claim({ inventoryItemId: second.inventoryItemId, orderRecordId: 'ol_order_B', orderLineId: 'l1' }),
        claim({ inventoryItemId: first.inventoryItemId, orderRecordId: 'ol_order_B', orderLineId: 'l2' }),
      ]);

      await expect(Promise.all([forwards, backwards])).resolves.toBeDefined();

      expect(await readCounter(dataSource, first.inventoryItemId)).toBe(2);
      expect(await readCounter(dataSource, second.inventoryItemId)).toBe(2);
    });

    it('should roll back every line when a later line in the same claim is refused', async () => {
      // All-or-nothing: a partially-reserved order must never persist.
      const plenty = await seedPosition(dataSource, 10);
      const scarce = await seedPosition(dataSource, 1);
      const [firstId, secondId] = [plenty.inventoryItemId, scarce.inventoryItemId].sort();

      await expect(
        reservations.claimHeld([
          claim({ inventoryItemId: firstId, orderLineId: 'l1', quantity: 1 }),
          claim({ inventoryItemId: secondId, orderLineId: 'l2', quantity: 5 }),
        ]),
      ).rejects.toBeInstanceOf(Error);

      expect(await readCounter(dataSource, plenty.inventoryItemId)).toBe(0);
      expect(await readCounter(dataSource, scarce.inventoryItemId)).toBe(0);
      const rows = (await dataSource.query(`SELECT COUNT(*)::int AS n FROM "reservations"`)) as {
        n: number;
      }[];
      expect(rows[0].n).toBe(0);
    });

    it('should refuse a claim against a stale position with a distinct named error', async () => {
      // A position whose variant vanished from the master must not accept new
      // promises — and "cannot reserve here at all" is a different operator
      // situation from "not enough units", so it gets its own error.
      const position = await seedPosition(dataSource, 100, { isStale: true });

      const rejection = await reservations
        .claimHeld([claim({ inventoryItemId: position.inventoryItemId })])
        .catch((e: unknown) => e);

      expect(rejection).toBeInstanceOf(ReservationPositionUnavailableError);
      expect(rejection).toMatchObject({ reason: 'stale' });
    });

    it('should refuse a claim against a position that does not exist', async () => {
      const rejection = await reservations
        .claimHeld([claim({ inventoryItemId: 'ol_inventoryitem_absent' })])
        .catch((e: unknown) => e);

      expect(rejection).toBeInstanceOf(ReservationPositionUnavailableError);
      expect(rejection).toMatchObject({ reason: 'missing' });
    });
  });

  describe('idempotency and delta-adjust', () => {
    it('should grant a repeated claim, create no second row and move the counter not at all', async () => {
      // The partial unique index IS the idempotency key. Without this an
      // ingestion crash after `claimHeld` would wedge the order forever behind a
      // false "insufficient stock" (ADR-061 amendment 2).
      const position = await seedPosition(dataSource, 10);
      const input = claim({ inventoryItemId: position.inventoryItemId, quantity: 3 });

      const [first] = await reservations.claimHeld([input]);
      const [second] = await reservations.claimHeld([input]);

      expect(second.reservation.id).toBe(first.reservation.id);
      expect(second.deltaApplied).toBe(0);
      expect(await readCounter(dataSource, position.inventoryItemId)).toBe(3);
      const rows = (await dataSource.query(`SELECT COUNT(*)::int AS n FROM "reservations"`)) as {
        n: number;
      }[];
      expect(rows[0].n).toBe(1);
    });

    it('should delta-adjust an amended line up and down through the same guard', async () => {
      const position = await seedPosition(dataSource, 10);
      const base = claim({ inventoryItemId: position.inventoryItemId, quantity: 2 });

      await reservations.claimHeld([base]);
      const [widened] = await reservations.claimHeld([{ ...base, quantity: 6 }]);
      expect(widened.deltaApplied).toBe(4);
      expect(await readCounter(dataSource, position.inventoryItemId)).toBe(6);

      const [narrowed] = await reservations.claimHeld([{ ...base, quantity: 1 }]);
      expect(narrowed.deltaApplied).toBe(-5);
      expect(await readCounter(dataSource, position.inventoryItemId)).toBe(1);
    });

    it('should leave the original quantity intact when an amendment exceeds availability', async () => {
      const position = await seedPosition(dataSource, 3);
      const base = claim({ inventoryItemId: position.inventoryItemId, quantity: 2 });
      await reservations.claimHeld([base]);

      await expect(reservations.claimHeld([{ ...base, quantity: 9 }])).rejects.toBeInstanceOf(
        InsufficientAvailabilityError,
      );

      const held = await reservations.findHeld(base);
      expect(held?.quantity).toBe(2);
      expect(await readCounter(dataSource, position.inventoryItemId)).toBe(2);
    });

    it('should admit a second row for the same line once the first is terminal', async () => {
      // The unique index is PARTIAL on status='held' precisely so a released
      // line can be re-reserved without colliding with its own history.
      const position = await seedPosition(dataSource, 10);
      const input = claim({ inventoryItemId: position.inventoryItemId, quantity: 2 });

      const [first] = await reservations.claimHeld([input]);
      await reservations.releaseHeld({ ...input, terminalStatus: 'released' });
      const [second] = await reservations.claimHeld([input]);

      expect(second.reservation.id).not.toBe(first.reservation.id);
      expect(await readCounter(dataSource, position.inventoryItemId)).toBe(2);
    });
  });

  describe('release', () => {
    it('should decrement exactly once when two releases race', async () => {
      const position = await seedPosition(dataSource, 10);
      const input = claim({ inventoryItemId: position.inventoryItemId, quantity: 4 });
      await reservations.claimHeld([input]);

      const results = await Promise.allSettled([
        reservations.releaseHeld({ ...input, terminalStatus: 'released' }),
        reservations.releaseHeld({ ...input, terminalStatus: 'released' }),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(refused.reason).toBeInstanceOf(ReservationNotHeldError);
      expect(await readCounter(dataSource, position.inventoryItemId)).toBe(0);
    });

    it('should raise ReservationNotHeldError for a key that was never held', async () => {
      const position = await seedPosition(dataSource, 10);

      await expect(
        reservations.releaseHeld({
          ...claim({ inventoryItemId: position.inventoryItemId }),
          terminalStatus: 'consumed',
        }),
      ).rejects.toBeInstanceOf(ReservationNotHeldError);
    });
  });

  describe('reads', () => {
    it('should list only live rows for an order and exclude terminal ones', async () => {
      const kept = await seedPosition(dataSource, 10);
      const closed = await seedPosition(dataSource, 10);
      const orderRecordId = 'ol_order_reads';

      await reservations.claimHeld([
        claim({ inventoryItemId: kept.inventoryItemId, orderRecordId, orderLineId: 'l1' }),
        claim({ inventoryItemId: closed.inventoryItemId, orderRecordId, orderLineId: 'l2' }),
      ]);
      await reservations.releaseHeld({
        orderRecordId,
        orderLineId: 'l2',
        inventoryItemId: closed.inventoryItemId,
        terminalStatus: 'consumed',
      });

      const live = await reservations.listHeldByOrderRecordId(orderRecordId);
      expect(live).toHaveLength(1);
      expect(live[0].inventoryItemId).toBe(kept.inventoryItemId);

      // The terminal row is KEPT, not deleted — consumers filter on status.
      const rows = (await dataSource.query(`SELECT COUNT(*)::int AS n FROM "reservations"`)) as {
        n: number;
      }[];
      expect(rows[0].n).toBe(2);
    });
  });

  describe('the constraints themselves', () => {
    it('should refuse a negative olReservedQuantity even when the guard is bypassed', async () => {
      // § 6I's hard floor. The guarded WHERE makes this unreachable through the
      // port, which is exactly why the CHECK must be asserted directly.
      const position = await seedPosition(dataSource, 10);

      await expect(
        dataSource.query(`UPDATE "inventory_items" SET "olReservedQuantity" = -1 WHERE "id" = $1`, [
          position.inventoryItemId,
        ]),
      ).rejects.toThrow(/CHK_inventory_items_ol_reserved_nonneg/);
    });

    it('should PERSIST a master drop below the committed reservation set', async () => {
      // Asserts an ABSENCE, deliberately: there is no
      // `CHECK (olReserved <= available)`, because such a constraint would make
      // the master SYNC fail rather than surface the shortfall — and the
      // shortfall is a fact an operator must see (`W2-12`).
      const position = await seedPosition(dataSource, 10);
      await reservations.claimHeld([
        claim({ inventoryItemId: position.inventoryItemId, quantity: 8 }),
      ]);

      await expect(
        dataSource.query(`UPDATE "inventory_items" SET "availableQuantity" = 2 WHERE "id" = $1`, [
          position.inventoryItemId,
        ]),
      ).resolves.toBeDefined();

      const rows = (await dataSource.query(
        `SELECT "availableQuantity", "olReservedQuantity" FROM "inventory_items" WHERE "id" = $1`,
        [position.inventoryItemId],
      )) as { availableQuantity: number; olReservedQuantity: number }[];
      expect(Number(rows[0].olReservedQuantity)).toBeGreaterThan(Number(rows[0].availableQuantity));
    });

    it('should refuse a zero-quantity claim before it reaches the database', async () => {
      const position = await seedPosition(dataSource, 10);

      await expect(
        reservations.claimHeld([claim({ inventoryItemId: position.inventoryItemId, quantity: 0 })]),
      ).rejects.toBeInstanceOf(RangeError);
    });

    it('should refuse to delete a position that still carries a live reservation', async () => {
      // ON DELETE RESTRICT (§ 6I): a row with live reservations must not vanish;
      // the stale path soft-marks instead.
      const position = await seedPosition(dataSource, 10);
      await reservations.claimHeld([claim({ inventoryItemId: position.inventoryItemId })]);

      await expect(
        dataSource.query(`DELETE FROM "inventory_items" WHERE "id" = $1`, [
          position.inventoryItemId,
        ]),
      ).rejects.toThrow();
    });
  });
  /**
   * The service layer's own guarantees (#2344), on real Postgres.
   *
   * These are the two properties a mocked repository cannot prove, because both
   * are about what the PARTIAL unique index (`WHERE status = 'held'`) does:
   * a repeat claim conflicts and recovers, and a TERMINAL row does not conflict
   * at all — which is exactly why the service must gate on it.
   */
  describe('the reservation service (#2344)', () => {
    let service: IReservationService;

    beforeAll(() => {
      service = harness.getApp().get<IReservationService>(RESERVATION_SERVICE_TOKEN);
    });

    it('should leave the order re-reservable after a crash between insert and commit', async () => {
      // Simulates the ingestion crash amendment 2 exists for: the claim's
      // transaction rolled back, so nothing persisted, and the retry must
      // succeed rather than wedge behind a false "insufficient stock".
      const position = await seedPosition(dataSource, 10);
      const orderRecordId = 'ol_order_crash_1';

      await dataSource.transaction(async (manager) => {
        await manager.query(
          `INSERT INTO "reservations"
             ("orderRecordId","orderLineId","inventoryItemId","quantity","status","expiresAt","atpEffect")
           VALUES ($1,$2,$3,$4,'held',$5,'published')`,
          [orderRecordId, 'line-1', position.inventoryItemId, 3, EXPIRES_AT],
        );
        throw new Error('simulated crash before commit');
      }).catch(() => undefined);

      const result = await service.reserveForOrder({
        orderRecordId,
        atpEffect: 'published',
        lines: [
          {
            orderLineId: 'line-1',
            productId: position.productId,
            productVariantId: position.variantId,
            quantity: 3,
          },
        ],
      });

      expect(result.granted).toHaveLength(1);
      expect(result.granted[0].deltaApplied).toBe(3);
      expect(await readCounter(dataSource, position.inventoryItemId)).toBe(3);
    });

    it('should create no second row when the same order is reserved twice', async () => {
      const position = await seedPosition(dataSource, 10);
      const orderRecordId = 'ol_order_replay_1';
      const input = {
        orderRecordId,
        atpEffect: 'published' as const,
        lines: [
          {
            orderLineId: 'line-1',
            productId: position.productId,
            productVariantId: position.variantId,
            quantity: 2,
          },
        ],
      };

      const first = await service.reserveForOrder(input);
      const second = await service.reserveForOrder(input);

      expect(first.granted[0].deltaApplied).toBe(2);
      expect(second.granted[0].deltaApplied).toBe(0);
      expect(await readCounter(dataSource, position.inventoryItemId)).toBe(2);

      const rows = (await dataSource.query(
        `SELECT COUNT(*)::int AS count FROM "reservations" WHERE "orderRecordId" = $1`,
        [orderRecordId],
      )) as { count: number }[];
      expect(rows[0].count).toBe(1);
    });

    it('should not resurrect a released reservation on a later re-ingestion', async () => {
      // The idempotency index is partial on `status = 'held'`, so a released row
      // does NOT block a fresh insert. Ingestion re-runs on every re-poll, so
      // without the terminal-state gate this would mint a second hold and
      // double-count the counter.
      const position = await seedPosition(dataSource, 10);
      const orderRecordId = 'ol_order_resurrect_1';
      const input = {
        orderRecordId,
        atpEffect: 'published' as const,
        lines: [
          {
            orderLineId: 'line-1',
            productId: position.productId,
            productVariantId: position.variantId,
            quantity: 4,
          },
        ],
      };

      await service.reserveForOrder(input);
      await reservations.releaseHeld({
        orderRecordId,
        orderLineId: 'line-1',
        inventoryItemId: position.inventoryItemId,
        terminalStatus: 'released',
      });
      expect(await readCounter(dataSource, position.inventoryItemId)).toBe(0);

      const replay = await service.reserveForOrder(input);

      expect(replay.granted).toEqual([]);
      expect(replay.skipped).toEqual([{ orderLineId: 'line-1', reason: 'already-closed' }]);
      expect(await readCounter(dataSource, position.inventoryItemId)).toBe(0);
    });
  });
});
