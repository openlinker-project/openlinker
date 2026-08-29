/**
 * Cancellation: release the ledger, THEN restore ATP (#2348)
 *
 * The unit specs prove the ordering two ways — `publishRestoredAtp` takes the
 * release's own `CloseForOrderResult`, so an inverted order does not compile,
 * and a shared recorder pins the effects. What only real Postgres can prove is
 * the thing the ordering EXISTS for: that releasing actually moves the number,
 * by exactly the reserved amount, exactly once.
 *
 * Three claims, each an acceptance criterion:
 *
 * - **AC-1: exactly one ATP increase, of the right size.** ATP is read before
 *   and after; the release runs three times and the number moves once. That is
 *   the whole reason the restore may not run first — read before the release,
 *   it publishes a quantity SHORT by exactly the cancelled amount.
 * - **AC-3: a cancelled-after-dispatch order does not double-restore.** The
 *   predicate is the durable `Shipment.reservationConsumedAt` claim, read
 *   through `IShipmentQueryService` against real rows (including the partial
 *   index the column carries), never an inference from reservation status —
 *   which cannot distinguish "consumed" from "never reserved" at all.
 * - **`availableQuantity` is untouched.** Release lowers `olReservedQuantity`
 *   only; the master owns on-hand stock.
 *
 * `atpEffect` is stamped `published` deliberately: on a default install every
 * hold is `diagnostic` (#2344), so a spec asserting an ATP-visible change must
 * stamp it explicitly or it proves nothing.
 *
 * The harness builds its schema by `synchronize`, matching every #2314 / #2343
 * sibling.
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
  INVENTORY_QUERY_SERVICE_TOKEN,
  RESERVATION_SERVICE_TOKEN,
  type IInventoryQueryService,
  type IReservationService,
} from '@openlinker/core/inventory';
import {
  SHIPMENT_QUERY_SERVICE_TOKEN,
  type IShipmentQueryService,
} from '@openlinker/core/shipping';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

const EXPIRES_AT = new Date('2027-01-01T00:00:00.000Z');
const CONNECTION_ID = '00000000-0000-0000-0000-0000000000c2';

interface Seeded {
  orderId: string;
  variantId: string;
  inventoryItemId: string;
}

async function seed(
  dataSource: DataSource,
  options: { availableQuantity: number; heldQuantity: number }
): Promise<Seeded> {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  const productId = `ol_product_cx_${suffix}`;
  const variantId = `ol_variant_cx_${suffix}`;
  const inventoryItemId = `ol_inventoryitem_cx_${suffix}`;
  const orderId = `ol_order_cx_${suffix}`;

  const productRepo = dataSource.getRepository(ProductOrmEntity);
  await productRepo.save(
    productRepo.create({ id: productId, name: `Cancel Test ${suffix}`, sku: null, price: null })
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
      availableQuantity: options.availableQuantity,
      reservedQuantity: 0,
      olReservedQuantity: options.heldQuantity,
      locationId: null,
      sourceConnectionId: 'conn-cx-test',
      isStale: false,
    })
  );

  await dataSource.query(
    `INSERT INTO "reservations"
       ("orderRecordId", "orderLineId", "inventoryItemId", "quantity", "status", "expiresAt", "atpEffect", "closedAt")
     VALUES ($1, $2, $3, $4, 'held', $5, 'published', NULL)`,
    [orderId, `line-${suffix}`, inventoryItemId, options.heldQuantity, EXPIRES_AT]
  );

  return { orderId, variantId, inventoryItemId };
}

describe('Cancellation release-then-restore against the real ledger (#2348)', () => {
  let harness: IntegrationTestHarness;
  let dataSource: DataSource;
  let reservations: IReservationService;
  let inventoryQuery: IInventoryQueryService;
  let shipments: IShipmentQueryService;

  const atpFor = async (variantId: string): Promise<number | null> => {
    const [row] = await inventoryQuery.getAvailabilityByVariantIds([variantId]);
    return row?.availableToPromise ?? null;
  };

  const ledgerStatuses = async (orderId: string): Promise<string[]> => {
    const rows = (await dataSource.query(
      `SELECT "status" FROM "reservations" WHERE "orderRecordId" = $1 ORDER BY "orderLineId"`,
      [orderId]
    )) as Array<{ status: string }>;
    return rows.map((row) => row.status);
  };

  const positionCounters = async (
    inventoryItemId: string
  ): Promise<{ available: number; olReserved: number }> => {
    const [row] = (await dataSource.query(
      `SELECT "availableQuantity", "olReservedQuantity" FROM "inventory_items" WHERE "id" = $1`,
      [inventoryItemId]
    )) as Array<{ availableQuantity: number; olReservedQuantity: number }>;
    return { available: Number(row.availableQuantity), olReserved: Number(row.olReservedQuantity) };
  };

  beforeAll(async () => {
    harness = await getTestHarness();
    dataSource = harness.getDataSource();
    const app = harness.getApp();
    reservations = app.get<IReservationService>(RESERVATION_SERVICE_TOKEN);
    inventoryQuery = app.get<IInventoryQueryService>(INVENTORY_QUERY_SERVICE_TOKEN);
    shipments = app.get<IShipmentQueryService>(SHIPMENT_QUERY_SERVICE_TOKEN);
  }, 120_000);

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('should raise ATP exactly once, by exactly the reserved quantity (AC-1)', async () => {
    const seeded = await seed(dataSource, { availableQuantity: 10, heldQuantity: 4 });

    // Before: the hold is subtracted, so ATP is short by the reserved amount.
    // A restore reading HERE is precisely the defect #2348 closes.
    expect(await atpFor(seeded.variantId)).toBe(6);

    const first = await reservations.closeForOrder({
      orderRecordId: seeded.orderId,
      terminalStatus: 'released',
    });
    const afterFirst = await atpFor(seeded.variantId);

    // Repeats are the crash-kill case: the job is retried after a process kill
    // that landed anywhere in the sequence. The guarded UPDATE is what makes the
    // repeat decrement nothing, so the number does not move again.
    const second = await reservations.closeForOrder({
      orderRecordId: seeded.orderId,
      terminalStatus: 'released',
    });
    const third = await reservations.closeForOrder({
      orderRecordId: seeded.orderId,
      terminalStatus: 'released',
    });

    expect(first).toEqual({ closed: 1, alreadyTerminal: 0, failed: 0 });
    expect(afterFirst).toBe(10);
    expect(second).toEqual({ closed: 0, alreadyTerminal: 0, failed: 0 });
    expect(third).toEqual({ closed: 0, alreadyTerminal: 0, failed: 0 });
    expect(await atpFor(seeded.variantId)).toBe(10);

    expect(await ledgerStatuses(seeded.orderId)).toEqual(['released']);
  });

  it('should never touch availableQuantity', async () => {
    // The master owns on-hand stock and reports its own numbers on the next
    // sync; a second author would make the two drift.
    const seeded = await seed(dataSource, { availableQuantity: 10, heldQuantity: 4 });

    await reservations.closeForOrder({
      orderRecordId: seeded.orderId,
      terminalStatus: 'released',
    });

    expect(await positionCounters(seeded.inventoryItemId)).toEqual({
      available: 10,
      olReserved: 0,
    });
  });

  it('should report a dispatched order as already consumed, and a live one as not (AC-3)', async () => {
    // The durable marker is the ONLY honest predicate: the ledger returns held
    // rows only, so "consumed", "expired" and "never reserved" are one empty
    // answer there.
    const shipped = await seed(dataSource, { availableQuantity: 10, heldQuantity: 1 });
    const live = await seed(dataSource, { availableQuantity: 10, heldQuantity: 1 });

    await dataSource.query(
      `INSERT INTO "shipments"
         ("id", "orderId", "connectionId", "shippingMethod", "status", "reservationConsumedAt")
       VALUES ($1, $2, $3, 'kurier', 'dispatched', $4),
              ($5, $6, $3, 'kurier', 'dispatched', NULL)`,
      [
        `ol_shipment_cx_shipped`,
        shipped.orderId,
        CONNECTION_ID,
        new Date('2026-05-21T16:00:00Z'),
        `ol_shipment_cx_live`,
        live.orderId,
      ]
    );

    await expect(shipments.hasConsumedReservations(shipped.orderId)).resolves.toBe(true);
    await expect(shipments.hasConsumedReservations(live.orderId)).resolves.toBe(false);
    // An order with no shipment at all is not "consumed" either.
    await expect(shipments.hasConsumedReservations('ol_order_cx_absent')).resolves.toBe(false);
  });
});
