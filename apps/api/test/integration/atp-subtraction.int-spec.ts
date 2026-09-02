/**
 * ATP subtraction against the real ledger (#2345, ADR-061 decision 1)
 *
 * Story I4: an ingested order reduces what channels may promise *before* the
 * master notices. The unit specs prove the arithmetic against an in-memory
 * fake, which cannot prove the thing that actually decides a published number —
 * the SQL predicate. Only real Postgres can show that:
 *
 * - a `published` hold lowers available-to-promise, and a `diagnostic` one
 *   does not (the answer to §6I's original kill condition, which must not be
 *   configurable);
 * - a hold that has gone terminal stops counting, even though its row is kept
 *   forever;
 * - a hold against a STALE position is excluded, matching the numerator's own
 *   `isStale = false` filter — otherwise the variant silently under-publishes;
 * - a hold on one variant never leaks into another's sum.
 *
 * Story I1 — an install with zero reservations publishes byte-identically to
 * before the ledger existed — is asserted separately and end-to-end by
 * `publish-quantity-parity.int-spec.ts`, which drives a real publish payload;
 * the empty-ledger case here is the same claim at this seam.
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
  AVAILABILITY_SERVICE_TOKEN,
  type IAvailabilityService,
  type AvailabilityScope,
  type ReservationAtpEffect,
  type ReservationStatus,
} from '@openlinker/core/inventory';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

const GLOBAL_SCOPE: AvailabilityScope = { kind: 'global' };
const EXPIRES_AT = new Date('2027-01-01T00:00:00.000Z');

interface SeededPosition {
  inventoryItemId: string;
  productId: string;
  variantId: string;
}

async function seedPosition(
  dataSource: DataSource,
  availableQuantity: number,
  options: { isStale?: boolean } = {}
): Promise<SeededPosition> {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  const productId = `ol_product_atp_${suffix}`;
  const variantId = `ol_variant_atp_${suffix}`;
  const inventoryItemId = `ol_inventoryitem_atp_${suffix}`;

  const productRepo = dataSource.getRepository(ProductOrmEntity);
  await productRepo.save(
    productRepo.create({ id: productId, name: `ATP Test ${suffix}`, sku: null, price: null })
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
      availableQuantity,
      reservedQuantity: 0,
      olReservedQuantity: 0,
      locationId: null,
      sourceConnectionId: 'conn-atp-test',
      isStale: options.isStale ?? false,
    })
  );

  return { inventoryItemId, productId, variantId };
}

/**
 * Insert a ledger row directly.
 *
 * Deliberately NOT through `claimHeld`: the subject here is the READ predicate,
 * and the write path guards availability and would refuse the very shapes this
 * spec needs (a hold against a stale position, a hold larger than stock, a
 * terminal row). #2343's own int-spec owns the write path.
 */
async function insertReservation(
  dataSource: DataSource,
  input: {
    inventoryItemId: string;
    quantity: number;
    atpEffect: ReservationAtpEffect;
    status?: ReservationStatus;
    orderLineId?: string;
  }
): Promise<void> {
  await dataSource.query(
    `INSERT INTO "reservations"
       ("orderRecordId", "orderLineId", "inventoryItemId", "quantity", "status", "expiresAt", "atpEffect", "closedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      'ol_order_atp_1',
      input.orderLineId ?? `line-${Math.floor(Math.random() * 1_000_000)}`,
      input.inventoryItemId,
      input.quantity,
      input.status ?? 'held',
      EXPIRES_AT,
      input.atpEffect,
      input.status && input.status !== 'held' ? EXPIRES_AT : null,
    ]
  );
}

describe('ATP subtraction against the reservation ledger (#2345)', () => {
  let harness: IntegrationTestHarness;
  let dataSource: DataSource;
  let availability: IAvailabilityService;

  const promisableFor = async (variantId: string): Promise<number | null> => {
    const [result] = await availability.getPromisableQuantities({
      variantIds: [variantId],
      scope: GLOBAL_SCOPE,
    });
    return result.quantity;
  };

  beforeAll(async () => {
    harness = await getTestHarness();
    dataSource = harness.getDataSource();
    availability = harness.getApp().get<IAvailabilityService>(AVAILABILITY_SERVICE_TOKEN);
  }, 120_000);

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('should lower the promisable quantity by a published hold', async () => {
    const position = await seedPosition(dataSource, 10);
    await insertReservation(dataSource, {
      inventoryItemId: position.inventoryItemId,
      quantity: 4,
      atpEffect: 'published',
    });

    expect(await promisableFor(position.variantId)).toBe(6);
  });

  it('should NOT lower the promisable quantity by a diagnostic hold', async () => {
    const position = await seedPosition(dataSource, 10);
    await insertReservation(dataSource, {
      inventoryItemId: position.inventoryItemId,
      quantity: 4,
      atpEffect: 'diagnostic',
    });

    expect(await promisableFor(position.variantId)).toBe(10);
  });

  it('should subtract only the published portion when both stamps are held on one position', async () => {
    const position = await seedPosition(dataSource, 10);
    await insertReservation(dataSource, {
      inventoryItemId: position.inventoryItemId,
      quantity: 3,
      atpEffect: 'published',
      orderLineId: 'line-published',
    });
    await insertReservation(dataSource, {
      inventoryItemId: position.inventoryItemId,
      quantity: 100,
      atpEffect: 'diagnostic',
      orderLineId: 'line-diagnostic',
    });

    expect(await promisableFor(position.variantId)).toBe(7);
  });

  it.each(['released', 'consumed', 'expired'] as const)(
    'should stop counting a %s hold, whose row is kept forever',
    async (status) => {
      const position = await seedPosition(dataSource, 10);
      await insertReservation(dataSource, {
        inventoryItemId: position.inventoryItemId,
        quantity: 4,
        atpEffect: 'published',
        status,
      });

      expect(await promisableFor(position.variantId)).toBe(10);
    }
  );

  it('should exclude a hold against a stale position, matching the numerator filter', async () => {
    const position = await seedPosition(dataSource, 10, { isStale: true });
    await insertReservation(dataSource, {
      inventoryItemId: position.inventoryItemId,
      quantity: 4,
      atpEffect: 'published',
    });

    // The stale position contributes nothing to the total, so its hold must
    // contribute nothing to the subtraction — otherwise the answer is -4
    // clamped to 0 and the variant stops selling for no reason.
    expect(await promisableFor(position.variantId)).toBe(0);
  });

  it('should never drive the promisable quantity below zero', async () => {
    const position = await seedPosition(dataSource, 2);
    await insertReservation(dataSource, {
      inventoryItemId: position.inventoryItemId,
      quantity: 50,
      atpEffect: 'published',
    });

    expect(await promisableFor(position.variantId)).toBe(0);
  });

  it("should not let one variant's hold reduce another variant's quantity", async () => {
    const held = await seedPosition(dataSource, 10);
    const untouched = await seedPosition(dataSource, 10);
    await insertReservation(dataSource, {
      inventoryItemId: held.inventoryItemId,
      quantity: 4,
      atpEffect: 'published',
    });

    expect(await promisableFor(held.variantId)).toBe(6);
    expect(await promisableFor(untouched.variantId)).toBe(10);
  });

  it('should publish the un-reserved quantity while the ledger is empty (Story I1)', async () => {
    const position = await seedPosition(dataSource, 10);

    expect(await promisableFor(position.variantId)).toBe(10);
  });

  it('should report olHeldNotReflected as null on the computed path', async () => {
    const position = await seedPosition(dataSource, 10);
    await insertReservation(dataSource, {
      inventoryItemId: position.inventoryItemId,
      quantity: 4,
      atpEffect: 'published',
    });

    const [result] = await availability.getPromisableQuantities({
      variantIds: [position.variantId],
      scope: GLOBAL_SCOPE,
    });

    expect(result.provenance).toBe('computed');
    expect(result.olHeldNotReflected).toBeNull();
  });
});
