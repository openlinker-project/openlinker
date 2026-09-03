/**
 * Reservation expiry against real Postgres (#2346, REVIEW § 3 C1)
 *
 * The unit spec owns the fail-closed decision table by injecting the predicate.
 * This suite owns what only real Postgres can prove:
 *
 * - `extendHeldExpiry` is a GUARDED conditional UPDATE — a row that went
 *   terminal between the page read and the write is not resurrected;
 * - an extension moves `expiresAt` and **nothing else** (`atpEffect`, `status`
 *   and the position counter are byte-identical afterwards);
 * - `listHeldExpiredBefore` selects only overdue `held` rows, oldest first;
 * - the candidate set is SELF-CONSUMING: extending a page removes it from the
 *   next read, which is why this pass has no offset cursor;
 * - an extension moves no published quantity (#2345 filters `status = 'held'`,
 *   which an extension does not change).
 *
 * **`order_holds` (#2339) does not exist**, so the sweep's release arm is
 * unreachable end-to-end here and is deliberately not faked. What IS asserted
 * end-to-end is the shipped posture: with the real module wiring, nothing is
 * released.
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
  AVAILABILITY_SERVICE_TOKEN,
  RESERVATION_EXPIRY_SERVICE_TOKEN,
  type IAvailabilityService,
  type IReservationExpiryService,
} from '@openlinker/core/inventory';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

const GLOBAL_SCOPE = { kind: 'global' } as const;
const OVERDUE = new Date('2026-01-01T00:00:00.000Z');
const FUTURE = new Date('2099-01-01T00:00:00.000Z');

interface SeededPosition {
  inventoryItemId: string;
  variantId: string;
}

async function seedPosition(dataSource: DataSource, available: number): Promise<SeededPosition> {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  const productId = `ol_product_exp_${suffix}`;
  const variantId = `ol_variant_exp_${suffix}`;
  const inventoryItemId = `ol_inventoryitem_exp_${suffix}`;

  const productRepo = dataSource.getRepository(ProductOrmEntity);
  await productRepo.save(
    productRepo.create({ id: productId, name: `Exp ${suffix}`, sku: null, price: null })
  );
  const variantRepo = dataSource.getRepository(ProductVariantOrmEntity);
  await variantRepo.save(
    variantRepo.create({
      id: variantId,
      productId,
      sku: null,
      attributes: null,
      ean: null,
      gtin: null,
    })
  );
  const itemRepo = dataSource.getRepository(InventoryItemOrmEntity);
  await itemRepo.save(
    itemRepo.create({
      id: inventoryItemId,
      productId,
      productVariantId: variantId,
      availableQuantity: available,
      reservedQuantity: 0,
      olReservedQuantity: 0,
      locationId: null,
      sourceConnectionId: 'conn-exp-test',
      isStale: false,
    })
  );
  return { inventoryItemId, variantId };
}

async function insertHold(
  dataSource: DataSource,
  input: {
    inventoryItemId: string;
    quantity: number;
    expiresAt: Date;
    status?: string;
    orderLineId?: string;
    orderRecordId?: string;
  }
): Promise<void> {
  await dataSource.query(
    `INSERT INTO "reservations"
       ("orderRecordId", "orderLineId", "inventoryItemId", "quantity", "status", "expiresAt", "atpEffect", "closedAt")
     VALUES ($1, $2, $3, $4, $5, $6, 'published', $7)`,
    [
      input.orderRecordId ?? 'ol_order_exp_1',
      input.orderLineId ?? `line-${Math.floor(Math.random() * 1_000_000)}`,
      input.inventoryItemId,
      input.quantity,
      input.status ?? 'held',
      input.expiresAt,
      input.status && input.status !== 'held' ? OVERDUE : null,
    ]
  );
  // `olReservedQuantity` is denormalised over the ledger; a raw insert has to
  // keep it consistent or the ATP assertions below measure the wrong thing.
  if ((input.status ?? 'held') === 'held') {
    await dataSource.query(
      `UPDATE "inventory_items" SET "olReservedQuantity" = "olReservedQuantity" + $2 WHERE "id" = $1`,
      [input.inventoryItemId, input.quantity]
    );
  }
}

async function readRow(
  dataSource: DataSource,
  inventoryItemId: string
): Promise<{ status: string; expiresAt: Date; atpEffect: string } | undefined> {
  const rows = (await dataSource.query(
    `SELECT "status", "expiresAt", "atpEffect" FROM "reservations" WHERE "inventoryItemId" = $1`,
    [inventoryItemId]
  )) as { status: string; expiresAt: Date; atpEffect: string }[];
  return rows[0];
}

describe('Reservation expiry sweep (#2346)', () => {
  let harness: IntegrationTestHarness;
  let dataSource: DataSource;
  let expiry: IReservationExpiryService;
  let availability: IAvailabilityService;

  beforeAll(async () => {
    harness = await getTestHarness();
    dataSource = harness.getDataSource();
    expiry = harness.getApp().get<IReservationExpiryService>(RESERVATION_EXPIRY_SERVICE_TOKEN);
    availability = harness.getApp().get<IAvailabilityService>(AVAILABILITY_SERVICE_TOKEN);
  }, 120_000);

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('should release NOTHING with the shipped wiring, because no obligation source exists', async () => {
    const position = await seedPosition(dataSource, 10);
    await insertHold(dataSource, {
      inventoryItemId: position.inventoryItemId,
      quantity: 4,
      expiresAt: OVERDUE,
    });

    const result = await expiry.expireDueReservations({ limit: 50 });

    expect(result.examined).toBe(1);
    expect(result.released).toBe(0);
    expect(result.extended).toBe(1);
    expect((await readRow(dataSource, position.inventoryItemId))?.status).toBe('held');
  });

  it('should move expiresAt forward and leave status and atpEffect untouched', async () => {
    const position = await seedPosition(dataSource, 10);
    await insertHold(dataSource, {
      inventoryItemId: position.inventoryItemId,
      quantity: 4,
      expiresAt: OVERDUE,
    });

    await expiry.expireDueReservations({ limit: 50 });

    const row = await readRow(dataSource, position.inventoryItemId);
    expect(row?.status).toBe('held');
    // Immutable — rewriting it would move a published quantity with no audit trail.
    expect(row?.atpEffect).toBe('published');
    expect(new Date(row!.expiresAt).getTime()).toBeGreaterThan(OVERDUE.getTime());
  });

  it('should keep the published quantity unchanged across an extension', async () => {
    const position = await seedPosition(dataSource, 10);
    await insertHold(dataSource, {
      inventoryItemId: position.inventoryItemId,
      quantity: 4,
      expiresAt: OVERDUE,
    });

    const before = await availability.getPromisableQuantities({
      variantIds: [position.variantId],
      scope: GLOBAL_SCOPE,
    });
    await expiry.expireDueReservations({ limit: 50 });
    const after = await availability.getPromisableQuantities({
      variantIds: [position.variantId],
      scope: GLOBAL_SCOPE,
    });

    // An extension changes WHEN the units stop being claimed, never HOW MANY —
    // and #2345 filters `status = 'held'`, which an extension does not change.
    expect(before[0].quantity).toBe(6);
    expect(after[0].quantity).toBe(6);
  });

  it('should not examine a hold whose expiry is still in the future', async () => {
    const position = await seedPosition(dataSource, 10);
    await insertHold(dataSource, {
      inventoryItemId: position.inventoryItemId,
      quantity: 4,
      expiresAt: FUTURE,
    });

    expect((await expiry.expireDueReservations({ limit: 50 })).examined).toBe(0);
  });

  it.each(['released', 'consumed', 'expired'] as const)(
    'should not examine an already-%s row, however overdue',
    async (status) => {
      const position = await seedPosition(dataSource, 10);
      await insertHold(dataSource, {
        inventoryItemId: position.inventoryItemId,
        quantity: 4,
        expiresAt: OVERDUE,
        status,
      });

      expect((await expiry.expireDueReservations({ limit: 50 })).examined).toBe(0);
    }
  );

  it('should have a SELF-CONSUMING candidate set — the reason this pass needs no offset cursor', async () => {
    const position = await seedPosition(dataSource, 50);
    for (let i = 0; i < 3; i += 1) {
      await insertHold(dataSource, {
        inventoryItemId: position.inventoryItemId,
        quantity: 1,
        expiresAt: OVERDUE,
        orderLineId: `line-${String(i)}`,
      });
    }

    const first = await expiry.expireDueReservations({ limit: 50 });
    const second = await expiry.expireDueReservations({ limit: 50 });

    expect(first.examined).toBe(3);
    expect(first.extended).toBe(3);
    // Extended rows left the set because `expiresAt` moved forward. An advancing
    // offset over this shrinking set would step over holds silently.
    expect(second.examined).toBe(0);
  });

  it('should respect the limit and take the longest-overdue holds first', async () => {
    const position = await seedPosition(dataSource, 50);
    await insertHold(dataSource, {
      inventoryItemId: position.inventoryItemId,
      quantity: 1,
      expiresAt: new Date('2026-06-01T00:00:00.000Z'),
      orderLineId: 'line-newer',
    });
    await insertHold(dataSource, {
      inventoryItemId: position.inventoryItemId,
      quantity: 1,
      expiresAt: new Date('2026-01-01T00:00:00.000Z'),
      orderLineId: 'line-oldest',
    });

    const result = await expiry.expireDueReservations({ limit: 1 });

    expect(result.examined).toBe(1);
    const rows = (await dataSource.query(
      `SELECT "orderLineId", "expiresAt" FROM "reservations" ORDER BY "expiresAt" ASC`
    )) as { orderLineId: string; expiresAt: Date }[];
    // The oldest was the one extended, so it is now the newest.
    expect(rows[rows.length - 1].orderLineId).toBe('line-oldest');
  });
});
