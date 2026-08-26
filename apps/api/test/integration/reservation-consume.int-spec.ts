/**
 * Reservation consume against the real ledger (#2347, REVIEW § 3 C8)
 *
 * The unit specs prove the ordering and the counters against fakes. What only
 * real Postgres can prove is the thing that decides whether stock leaks: that
 * the guarded UPDATE and the conditional claim actually make a repeat a no-op,
 * concurrently, against live rows.
 *
 * Four claims are asserted here, each one an acceptance criterion:
 *
 * - **The C8 regression** — a dispatch retry that short-circuits still results
 *   in exactly ONE consume. Exercised as the pass running three times over one
 *   shipment: one decrement, three runs.
 * - **`availableQuantity` is untouched** — consume lowers `olReservedQuantity`
 *   only. The master owns on-hand stock.
 * - **Two concurrent passes consume once** — the ledger's `status = 'held'`
 *   guard, not the marker, is what makes that true.
 * - **A cancelled shipment never consumes.**
 *
 * The harness builds its schema by `synchronize`, matching every #2314 / #2343
 * sibling — which is also what makes the migration/entity parity of the new
 * column and its partial index observable here at all.
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
  SHIPMENT_RESERVATION_CONSUME_SERVICE_TOKEN,
  type IShipmentReservationConsumeService,
} from '@openlinker/core/shipping';
import type { ShipmentStatus } from '@openlinker/core/shipping';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

const EXPIRES_AT = new Date('2027-01-01T00:00:00.000Z');
const CONNECTION_ID = '00000000-0000-0000-0000-0000000000c1';

interface Seeded {
  orderId: string;
  shipmentId: string;
  inventoryItemId: string;
}

/**
 * Seed a position, an order's hold on it, and a shipment for that order.
 *
 * `atpEffect` defaults to `published` deliberately: on a default install every
 * hold is `diagnostic` (#2344), so a spec asserting an ATP-visible change must
 * stamp `published` explicitly or it proves nothing.
 */
async function seed(
  dataSource: DataSource,
  options: {
    availableQuantity: number;
    heldQuantity: number;
    shipmentStatus?: ShipmentStatus;
    reservationConsumedAt?: Date | null;
  }
): Promise<Seeded> {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  const productId = `ol_product_rc_${suffix}`;
  const variantId = `ol_variant_rc_${suffix}`;
  const inventoryItemId = `ol_inventoryitem_rc_${suffix}`;
  const orderId = `ol_order_rc_${suffix}`;
  const shipmentId = `ol_shipment_rc_${suffix}`;

  const productRepo = dataSource.getRepository(ProductOrmEntity);
  await productRepo.save(
    productRepo.create({ id: productId, name: `Consume Test ${suffix}`, sku: null, price: null })
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
      sourceConnectionId: 'conn-rc-test',
      isStale: false,
    })
  );

  await dataSource.query(
    `INSERT INTO "reservations"
       ("orderRecordId", "orderLineId", "inventoryItemId", "quantity", "status", "expiresAt", "atpEffect", "closedAt")
     VALUES ($1, $2, $3, $4, 'held', $5, 'published', NULL)`,
    [orderId, `line-${suffix}`, inventoryItemId, options.heldQuantity, EXPIRES_AT]
  );

  await dataSource.query(
    `INSERT INTO "shipments"
       ("id", "orderId", "connectionId", "shippingMethod", "status", "reservationConsumedAt")
     VALUES ($1, $2, $3, 'kurier', $4, $5)`,
    [
      shipmentId,
      orderId,
      CONNECTION_ID,
      options.shipmentStatus ?? 'dispatched',
      options.reservationConsumedAt ?? null,
    ]
  );

  return { orderId, shipmentId, inventoryItemId };
}

describe('Reservation consume against the real ledger (#2347)', () => {
  let harness: IntegrationTestHarness;
  let dataSource: DataSource;
  let consume: IShipmentReservationConsumeService;

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

  const markerFor = async (shipmentId: string): Promise<Date | null> => {
    const [row] = (await dataSource.query(
      `SELECT "reservationConsumedAt" FROM "shipments" WHERE "id" = $1`,
      [shipmentId]
    )) as Array<{ reservationConsumedAt: Date | null }>;
    return row.reservationConsumedAt;
  };

  beforeAll(async () => {
    harness = await getTestHarness();
    dataSource = harness.getDataSource();
    consume = harness
      .getApp()
      .get<IShipmentReservationConsumeService>(SHIPMENT_RESERVATION_CONSUME_SERVICE_TOKEN);
  }, 120_000);

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('should consume exactly once across repeated runs (the C8 regression)', async () => {
    // A dispatch retry that short-circuits must not lose the consume, and a
    // repeated pass must not decrement twice. Three runs, one decrement.
    const seeded = await seed(dataSource, { availableQuantity: 10, heldQuantity: 4 });

    const first = await consume.consumeDueShipments({ limit: 10 });
    const second = await consume.consumeDueShipments({ limit: 10 });
    const third = await consume.consumeDueShipments({ limit: 10 });

    expect(first.consumed).toBe(1);
    expect(first.reservationsConsumed).toBe(1);
    // The marker retires the shipment from the candidate set, so later runs do
    // not even examine it.
    expect(second.examined).toBe(0);
    expect(third.examined).toBe(0);

    expect(await ledgerStatuses(seeded.orderId)).toEqual(['consumed']);
    expect((await positionCounters(seeded.inventoryItemId)).olReserved).toBe(0);
    expect(await markerFor(seeded.shipmentId)).toBeInstanceOf(Date);
  });

  it('should never touch availableQuantity (AC-3)', async () => {
    // The master owns on-hand stock and reports the decrement itself on its next
    // sync. A second author here would make the two drift silently.
    const seeded = await seed(dataSource, { availableQuantity: 10, heldQuantity: 4 });

    await consume.consumeDueShipments({ limit: 10 });

    const counters = await positionCounters(seeded.inventoryItemId);
    expect(counters.available).toBe(10);
    expect(counters.olReserved).toBe(0);
  });

  it('should consume once when two passes run concurrently', async () => {
    // The ledger's `status = 'held'` guarded UPDATE is what makes this true —
    // not the marker, which only stops re-examination. Both passes read the same
    // candidate; exactly one decrement must land.
    const seeded = await seed(dataSource, { availableQuantity: 10, heldQuantity: 6 });

    const [a, b] = await Promise.all([
      consume.consumeDueShipments({ limit: 10 }),
      consume.consumeDueShipments({ limit: 10 }),
    ]);

    // Exactly one pass claimed the marker; the other either lost the claim or
    // found the row already terminal. Neither is an error.
    expect(a.consumed + b.consumed).toBe(1);
    expect(a.failed + b.failed).toBe(0);
    expect(a.reservationsConsumed + b.reservationsConsumed).toBe(1);

    expect(await ledgerStatuses(seeded.orderId)).toEqual(['consumed']);
    expect((await positionCounters(seeded.inventoryItemId)).olReserved).toBe(0);
  });

  it('should not consume a cancelled shipment', async () => {
    const seeded = await seed(dataSource, {
      availableQuantity: 10,
      heldQuantity: 4,
      shipmentStatus: 'cancelled',
    });

    const result = await consume.consumeDueShipments({ limit: 10 });

    expect(result.examined).toBe(0);
    expect(await ledgerStatuses(seeded.orderId)).toEqual(['held']);
    expect((await positionCounters(seeded.inventoryItemId)).olReserved).toBe(4);
    expect(await markerFor(seeded.shipmentId)).toBeNull();
  });

  it('should not re-examine a shipment whose marker is already claimed', async () => {
    // The #2348 predicate: `reservationConsumedAt IS NOT NULL` is the durable
    // answer to "did this order already consume?", which is what keeps a
    // cancelled-after-dispatch order from double-restoring.
    const seeded = await seed(dataSource, {
      availableQuantity: 10,
      heldQuantity: 4,
      reservationConsumedAt: new Date('2026-08-01T00:00:00.000Z'),
    });

    const result = await consume.consumeDueShipments({ limit: 10 });

    expect(result.examined).toBe(0);
    expect(await ledgerStatuses(seeded.orderId)).toEqual(['held']);
  });

  it('should consume a delivered shipment that the pass never caught at dispatched', async () => {
    // A branch-1 projection row (#834) is born at its terminal status, so
    // `delivered` must be a candidate or those orders would never consume.
    const seeded = await seed(dataSource, {
      availableQuantity: 10,
      heldQuantity: 2,
      shipmentStatus: 'delivered',
    });

    const result = await consume.consumeDueShipments({ limit: 10 });

    expect(result.consumed).toBe(1);
    expect(await ledgerStatuses(seeded.orderId)).toEqual(['consumed']);
    expect((await positionCounters(seeded.inventoryItemId)).olReserved).toBe(0);
  });
});
