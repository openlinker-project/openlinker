/**
 * Published holds per (location, variant) against the real ledger (#3475)
 *
 * The fulfilment router must not route units OpenLinker has already promised.
 * The unit specs prove the subtraction against a fake; only real Postgres proves
 * the predicate that decides the number:
 *
 * - a `published` hold counts and a `diagnostic` one does not (ADR-061 decision 1);
 * - a terminal row stops counting although the row is kept forever;
 * - a stale position and a pooled (`locationId IS NULL`) position are excluded;
 * - holds are partitioned by location, and summed within one;
 * - the order being placed can be left out of its own sum (#3480 writes its hold
 *   BEFORE routing).
 *
 * Rows are inserted directly: the subject is the READ predicate, and the write
 * path's availability guard would refuse some of the shapes needed here.
 *
 * @module apps/api/test/integration
 */
import type { DataSource } from 'typeorm';
import { ProductOrmEntity, ProductVariantOrmEntity } from '@openlinker/core/products/orm-entities';
import { InventoryItemOrmEntity } from '@openlinker/core/inventory/orm-entities';
import {
  INVENTORY_QUERY_SERVICE_TOKEN,
  type IInventoryQueryService,
  type ReservationAtpEffect,
  type ReservationStatus,
} from '@openlinker/core/inventory';
import type {
  IntegrationTestHarness} from './setup';
import {
  getTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

const EXPIRES_AT = new Date('2027-01-01T00:00:00.000Z');

let sequence = 0;
const next = (): string => `${Date.now()}_${++sequence}`;

async function seedVariant(
  dataSource: DataSource
): Promise<{ productId: string; variantId: string }> {
  const suffix = next();
  const productId = `ol_product_loc_${suffix}`;
  const variantId = `ol_variant_loc_${suffix}`;
  const productRepo = dataSource.getRepository(ProductOrmEntity);
  await productRepo.save(
    productRepo.create({ id: productId, name: `Loc ${suffix}`, sku: null, price: null })
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
  return { productId, variantId };
}

async function seedPosition(
  dataSource: DataSource,
  base: { productId: string; variantId: string },
  options: { locationId: string | null; isStale?: boolean; sourceConnectionId?: string }
): Promise<string> {
  const id = `ol_inventoryitem_loc_${next()}`;
  const repo = dataSource.getRepository(InventoryItemOrmEntity);
  await repo.save(
    repo.create({
      id,
      productId: base.productId,
      productVariantId: base.variantId,
      availableQuantity: 10,
      reservedQuantity: 0,
      olReservedQuantity: 0,
      locationId: options.locationId,
      sourceConnectionId: options.sourceConnectionId ?? 'conn-loc-test',
      isStale: options.isStale ?? false,
    })
  );
  return id;
}

async function hold(
  dataSource: DataSource,
  input: {
    inventoryItemId: string;
    quantity: number;
    atpEffect?: ReservationAtpEffect;
    status?: ReservationStatus;
    orderRecordId?: string;
  }
): Promise<void> {
  const status = input.status ?? 'held';
  await dataSource.query(
    `INSERT INTO "reservations"
       ("orderRecordId", "orderLineId", "inventoryItemId", "quantity", "status", "expiresAt", "atpEffect", "closedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.orderRecordId ?? `ol_order_loc_${next()}`,
      `line-${next()}`,
      input.inventoryItemId,
      input.quantity,
      status,
      EXPIRES_AT,
      input.atpEffect ?? 'published',
      status === 'held' ? null : EXPIRES_AT,
    ]
  );
}

describe('published holds per location (#3475)', () => {
  let harness: IntegrationTestHarness;
  let dataSource: DataSource;
  let query: IInventoryQueryService;

  beforeAll(async () => {
    harness = await getTestHarness();
    dataSource = harness.getDataSource();
    query = harness.getApp().get<IInventoryQueryService>(INVENTORY_QUERY_SERVICE_TOKEN);
  }, 120_000);

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('should sum published holds within a location and keep locations apart', async () => {
    const base = await seedVariant(dataSource);
    const a = await seedPosition(dataSource, base, {
      locationId: 'loc-a',
      sourceConnectionId: 'c1',
    });
    const b = await seedPosition(dataSource, base, {
      locationId: 'loc-b',
      sourceConnectionId: 'c1',
    });
    await hold(dataSource, { inventoryItemId: a, quantity: 2 });
    await hold(dataSource, { inventoryItemId: a, quantity: 3 });
    await hold(dataSource, { inventoryItemId: b, quantity: 1 });

    const result = await query.listPublishedReservedByLocation([base.variantId]);

    expect([...result].sort((x, y) => x.locationId.localeCompare(y.locationId))).toEqual([
      { locationId: 'loc-a', productVariantId: base.variantId, reserved: 5 },
      { locationId: 'loc-b', productVariantId: base.variantId, reserved: 1 },
    ]);
  });

  it('should not count a diagnostic hold', async () => {
    const base = await seedVariant(dataSource);
    const a = await seedPosition(dataSource, base, { locationId: 'loc-a' });
    await hold(dataSource, { inventoryItemId: a, quantity: 4, atpEffect: 'diagnostic' });

    expect(await query.listPublishedReservedByLocation([base.variantId])).toEqual([]);
  });

  it.each<ReservationStatus>(['released', 'consumed', 'expired'])(
    'should not count a %s hold',
    async (status) => {
      const base = await seedVariant(dataSource);
      const a = await seedPosition(dataSource, base, { locationId: 'loc-a' });
      await hold(dataSource, { inventoryItemId: a, quantity: 4, status });

      expect(await query.listPublishedReservedByLocation([base.variantId])).toEqual([]);
    }
  );

  it('should not count a hold against a stale position', async () => {
    const base = await seedVariant(dataSource);
    const a = await seedPosition(dataSource, base, { locationId: 'loc-a', isStale: true });
    await hold(dataSource, { inventoryItemId: a, quantity: 4 });

    expect(await query.listPublishedReservedByLocation([base.variantId])).toEqual([]);
  });

  it('should not count a hold against a pooled position, which names no location', async () => {
    const base = await seedVariant(dataSource);
    const pooled = await seedPosition(dataSource, base, { locationId: null });
    await hold(dataSource, { inventoryItemId: pooled, quantity: 4 });

    expect(await query.listPublishedReservedByLocation([base.variantId])).toEqual([]);
  });

  it('should leave the excluded order out of its own sum and keep the rest', async () => {
    const base = await seedVariant(dataSource);
    const a = await seedPosition(dataSource, base, { locationId: 'loc-a' });
    await hold(dataSource, { inventoryItemId: a, quantity: 2, orderRecordId: 'ol_order_self' });
    await hold(dataSource, { inventoryItemId: a, quantity: 3, orderRecordId: 'ol_order_other' });

    const result = await query.listPublishedReservedByLocation([base.variantId], {
      excludeOrderRecordId: 'ol_order_self',
    });

    expect(result).toEqual([
      { locationId: 'loc-a', productVariantId: base.variantId, reserved: 3 },
    ]);
  });

  it('should not leak one variant into another', async () => {
    const one = await seedVariant(dataSource);
    const two = await seedVariant(dataSource);
    const a = await seedPosition(dataSource, one, { locationId: 'loc-a' });
    await seedPosition(dataSource, two, { locationId: 'loc-a' });
    await hold(dataSource, { inventoryItemId: a, quantity: 2 });

    expect(await query.listPublishedReservedByLocation([two.variantId])).toEqual([]);
  });

  it('should answer empty for an empty variant list without a statement', async () => {
    expect(await query.listPublishedReservedByLocation([])).toEqual([]);
  });
});
