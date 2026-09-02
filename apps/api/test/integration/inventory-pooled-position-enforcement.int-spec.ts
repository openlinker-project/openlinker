/**
 * Inventory Pooled-Position Enforcement Integration Test (#2322, ADR-058 decision (2))
 *
 * Vertical slice, against real Postgres, for the rule "`locationId IS NULL`
 * means the master declines to locate — never a default location". A source
 * that starts reporting a variant AT a location leaves its own pooled row
 * behind; that row is not a second warehouse, it is the same stock counted
 * twice, so the sync repairs it by soft-staling exactly that row.
 *
 * Four things a unit test over a mocked query builder cannot assert:
 *
 * - **The repair is SOFT and narrow.** The pooled row is flagged `isStale`;
 *   nothing is deleted, no `locationId` is rewritten, no location row is
 *   invented, and the located row it reacted to stays live. Availability drops
 *   by exactly the pooled quantity because the read already filters on
 *   `isStale = false`.
 * - **It is per-source.** A DIFFERENT connection's pooled row is legitimate
 *   stock that keeps summing — this master's decision to locate says nothing
 *   about the rival's. A read-time filter could not have made that distinction,
 *   which is why enforcement lives on the write path.
 * - **Unattributed rows are claimable only where the claim is provable.** A
 *   NULL-provenance row (an install that predates #2317) is staled by the sole
 *   claimant and left alone when a rival is present.
 * - **Reversal is half free.** A source that stops locating re-creates and
 *   un-stales its pooled row through the ordinary upsert — but the abandoned
 *   located row survives, because the ordinary prune's granularity is
 *   per-variant, not per-location. That gap is pinned by assertion below.
 *
 * Plus the no-op guarantee: a locationless-only sync — what both in-tree
 * adapters emit — leaves `isStale` and `updatedAt` byte-identical.
 *
 * Exercised through `IInventoryService` rather than the sync service so the
 * subject is the persisted predicate, not adapter plumbing. NOTE the harness
 * builds its schema by `synchronize`, matching its #2314 / #2319 / #2320
 * siblings; the file-local helpers below are copied from
 * `inventory-cross-source-positions.int-spec.ts`, which copied them in turn.
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
  IInventoryService,
  IInventoryQueryService,
  InventoryItemEntity,
  INVENTORY_SERVICE_TOKEN,
  INVENTORY_QUERY_SERVICE_TOKEN,
} from '@openlinker/core/inventory';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

const ALPHA = 'connection-alpha';
const BETA = 'connection-beta';

/** Every index definition on `inventory_items`, sorted — the byte-identical subject. */
async function readIndexDefs(dataSource: DataSource): Promise<string[]> {
  const rows = (await dataSource.query(
    `SELECT indexdef FROM pg_indexes WHERE tablename = 'inventory_items' ORDER BY indexdef`,
  )) as { indexdef: string }[];
  return rows.map((r) => r.indexdef);
}

/** Seeds a product + one variant, with NO inventory row. */
async function seedProductAndVariant(
  dataSource: DataSource,
): Promise<{ productId: string; variantId: string; suffix: string }> {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const productId = `ol_product_pooled_${suffix}`;
  const variantId = `ol_variant_pooled_${suffix}`;

  const productRepo = dataSource.getRepository(ProductOrmEntity);
  await productRepo.save(
    productRepo.create({ id: productId, name: `Pooled Test ${suffix}`, sku: null, price: null }),
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
    }),
  );

  return { productId, variantId, suffix };
}

function item(
  productId: string,
  variantId: string | null,
  quantity: number,
  sourceConnectionId: string | null,
  locationId: string | null = null,
): InventoryItemEntity {
  return new InventoryItemEntity(
    `ignored-${productId}-${sourceConnectionId ?? 'none'}-${locationId ?? 'pooled'}`,
    productId,
    variantId,
    quantity,
    0,
    locationId,
    new Date(),
    false,
    sourceConnectionId,
  );
}

const claimAll = (sourceConnectionId: string) => ({
  sourceConnectionId,
  includeUnattributedProvenance: true,
});

describe('Inventory pooled-position enforcement (#2322)', () => {
  let harness: IntegrationTestHarness;
  let inventoryService: IInventoryService;
  let inventoryQueryService: IInventoryQueryService;

  beforeAll(async () => {
    harness = await getTestHarness();
    inventoryService = harness.getApp().get<IInventoryService>(INVENTORY_SERVICE_TOKEN);
    inventoryQueryService = harness
      .getApp()
      .get<IInventoryQueryService>(INVENTORY_QUERY_SERVICE_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it("stales a source's own pooled row once it starts locating, softly and narrowly", async () => {
    const dataSource = harness.getDataSource();
    const { productId, variantId } = await seedProductAndVariant(dataSource);
    const inventoryRepo = dataSource.getRepository(InventoryItemOrmEntity);

    // Yesterday: alpha declined to locate. Today: it locates.
    await inventoryService.setInventory(item(productId, variantId, 7, ALPHA));
    await inventoryService.setInventory(item(productId, variantId, 7, ALPHA, 'loc-1'));

    const result = await inventoryService.staleLocationlessPositionsForSource(
      productId,
      [variantId],
      claimAll(ALPHA),
    );

    expect(result.markedCount).toBe(1);
    expect(result.variantIds).toEqual([variantId]);

    // SOFT: both rows survive. The pooled one is flagged, the located one is
    // live, and no `locationId` was rewritten into a synthetic default.
    const rows = await inventoryRepo.find({ where: { productId, productVariantId: variantId } });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.locationId === null)?.isStale).toBe(true);
    expect(rows.find((r) => r.locationId === 'loc-1')?.isStale).toBe(false);
    expect(rows.filter((r) => r.locationId === null)).toHaveLength(1);

    // The double count is gone: 7, not 14.
    const [availability] = await inventoryQueryService.getAvailabilityByVariantIds([variantId]);
    expect(availability.totalAvailable).toBe(7);
  });

  it("never invents a location and never touches a rival source's pooled row", async () => {
    const dataSource = harness.getDataSource();
    const { productId, variantId } = await seedProductAndVariant(dataSource);
    const inventoryRepo = dataSource.getRepository(InventoryItemOrmEntity);

    await inventoryService.setInventory(item(productId, variantId, 7, ALPHA));
    await inventoryService.setInventory(item(productId, variantId, 7, ALPHA, 'loc-1'));
    // Beta still declines to locate. That is a legitimate answer about beta's
    // stock, and alpha's decision says nothing about it.
    await inventoryService.setInventory(item(productId, variantId, 4, BETA));

    await inventoryService.staleLocationlessPositionsForSource(
      productId,
      [variantId],
      claimAll(ALPHA),
    );

    const rows = await inventoryRepo.find({ where: { productId, productVariantId: variantId } });
    expect(
      rows.find((r) => r.sourceConnectionId === BETA && r.locationId === null)?.isStale,
    ).toBe(false);

    // No synthetic DEFAULT location was minted for anybody — the explicitly
    // rejected alternative. The only located row is the one alpha wrote.
    expect(rows.filter((r) => r.locationId === null).map((r) => r.sourceConnectionId)).toEqual(
      expect.arrayContaining([ALPHA, BETA]),
    );
    expect(rows.map((r) => r.locationId).filter((l) => l !== null)).toEqual(['loc-1']);

    // Availability still sums beta's pooled stock beside alpha's located stock.
    const [availability] = await inventoryQueryService.getAvailabilityByVariantIds([variantId]);
    expect(availability.totalAvailable).toBe(11);
  });

  it('claims a NULL-provenance pooled row for the sole claimant', async () => {
    const dataSource = harness.getDataSource();
    const { productId, variantId, suffix } = await seedProductAndVariant(dataSource);
    const inventoryRepo = dataSource.getRepository(InventoryItemOrmEntity);

    // The install that actually HAS the bug: a pooled row written before the
    // provenance column existed. Strict same-source matching would no-op here.
    await inventoryRepo.save(
      inventoryRepo.create({
        id: `ol_inventory_pooled_${suffix}`,
        productId,
        productVariantId: variantId,
        availableQuantity: 7,
        reservedQuantity: 0,
        locationId: null,
      }),
    );
    await inventoryService.setInventory(item(productId, variantId, 7, ALPHA, 'loc-1'));

    const result = await inventoryService.staleLocationlessPositionsForSource(
      productId,
      [variantId],
      claimAll(ALPHA),
    );

    expect(result.markedCount).toBe(1);
    expect(
      (await inventoryRepo.find({ where: { productId, productVariantId: variantId } })).find(
        (r) => r.locationId === null,
      )?.isStale,
    ).toBe(true);
  });

  it('withholds the unattributed claim when a rival master is present', async () => {
    const dataSource = harness.getDataSource();
    const { productId, variantId, suffix } = await seedProductAndVariant(dataSource);
    const inventoryRepo = dataSource.getRepository(InventoryItemOrmEntity);

    await inventoryRepo.save(
      inventoryRepo.create({
        id: `ol_inventory_pooled_${suffix}`,
        productId,
        productVariantId: variantId,
        availableQuantity: 7,
        reservedQuantity: 0,
        locationId: null,
      }),
    );
    await inventoryService.setInventory(item(productId, variantId, 7, ALPHA, 'loc-1'));

    // What the sync passes when `isPruneBlockedByRivalMaster` returned true: a
    // row nobody owns cannot be proven to be this master's, so it is left alone.
    const result = await inventoryService.staleLocationlessPositionsForSource(
      productId,
      [variantId],
      { sourceConnectionId: ALPHA, includeUnattributedProvenance: false },
    );

    expect(result.markedCount).toBe(0);
    expect(
      (await inventoryRepo.find({ where: { productId, productVariantId: variantId } })).find(
        (r) => r.locationId === null,
      )?.isStale,
    ).toBe(false);
  });

  it('reverses for free when the source stops locating again', async () => {
    const dataSource = harness.getDataSource();
    const { productId, variantId } = await seedProductAndVariant(dataSource);
    const inventoryRepo = dataSource.getRepository(InventoryItemOrmEntity);

    await inventoryService.setInventory(item(productId, variantId, 7, ALPHA));
    await inventoryService.setInventory(item(productId, variantId, 7, ALPHA, 'loc-1'));
    await inventoryService.staleLocationlessPositionsForSource(
      productId,
      [variantId],
      claimAll(ALPHA),
    );

    // The master goes back to pooling. `isStale` is master-owned on upsert, so
    // the ordinary write un-stales the pooled row in place — no code needed for
    // the half of the reversal this slice is responsible for.
    await inventoryService.setInventory(item(productId, variantId, 9, ALPHA));
    await inventoryService.pruneStaleVariants(productId, [variantId], claimAll(ALPHA));

    const rows = await inventoryRepo.find({ where: { productId, productVariantId: variantId } });
    const pooledRow = rows.find((r) => r.locationId === null);
    expect(pooledRow?.isStale).toBe(false);
    expect(pooledRow?.availableQuantity).toBe(9);

    // KNOWN GAP, pinned rather than papered over: the ordinary prune's
    // granularity is per-VARIANT, not per-location (see the
    // `markStaleExceptVariants` port docblock — "a still-present variant that
    // the master stops returning at one specific location keeps all its
    // location rows live"). The variant is still present, so the abandoned
    // located row stays live and the total double-counts on the way BACK, at
    // 9 + 7. #2322 enforces decision (2) in one direction only; the
    // mirror-image sweep is multi-location pruning, which ADR-058 leaves out of
    // scope. Asserting the true number is what makes the gap visible to the
    // next reader instead of surfacing as a mystery overcount in production.
    expect(rows.find((r) => r.locationId === 'loc-1')?.isStale).toBe(false);
    const [availability] = await inventoryQueryService.getAvailabilityByVariantIds([variantId]);
    expect(availability.totalAvailable).toBe(16);
  });

  it('leaves a locationless-only sync byte-identical, indexes included', async () => {
    const dataSource = harness.getDataSource();
    const before = await readIndexDefs(dataSource);
    const { productId, variantId } = await seedProductAndVariant(dataSource);
    const inventoryRepo = dataSource.getRepository(InventoryItemOrmEntity);

    await inventoryService.setInventory(item(productId, variantId, 5, ALPHA));
    const [seeded] = await inventoryRepo.find({
      where: { productId, productVariantId: variantId },
    });

    // What both in-tree adapters emit: nothing located, so nothing to enforce
    // and — per the empty-set early return — no statement at all.
    const result = await inventoryService.staleLocationlessPositionsForSource(
      productId,
      [],
      claimAll(ALPHA),
    );
    expect(result).toEqual({ markedCount: 0, variantIds: [] });

    const [after] = await inventoryRepo.find({ where: { productId, productVariantId: variantId } });
    expect(after.isStale).toBe(false);
    // `updatedAt` is untouched: liveness changed for nobody, and this repair
    // never bumps the timestamp even when it does fire.
    expect(after.updatedAt.getTime()).toBe(seeded.updatedAt.getTime());
    expect(after.availableQuantity).toBe(5);

    // #2322 adds no column to any index — that is #2325's step.
    expect(await readIndexDefs(dataSource)).toEqual(before);
  });
});
