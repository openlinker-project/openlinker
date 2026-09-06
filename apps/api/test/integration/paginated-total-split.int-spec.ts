/**
 * Paginated Total Split Integration Test (#2944)
 *
 * The five repositories whose count can apply a predicate no plain index
 * serves now answer three ways: `findMany` (rows AND total, unchanged),
 * `findManyRows` (the page alone) and `countMany` (the total alone).
 *
 * The whole point of splitting them is that the total keeps describing the
 * SAME set as the page. That is a claim about real SQL under a real predicate,
 * so it is asserted against Testcontainers Postgres rather than against a
 * recording query-builder: a mocked builder can prove three methods called the
 * same private helper, but it cannot prove the helper's `ILIKE`, its jsonb
 * containment or its `EXISTS` subquery select the same rows in all three.
 *
 * Each block asserts three things per filter combination:
 *   1. `countMany(f)` equals `findMany(f, page).total`   - the totals agree
 *   2. `findManyRows(f, page)` equals `findMany(f, page).items` - the pages agree
 *   3. a filter CHANGE moves both together                - the shared predicate
 *
 * (3) is the acceptance criterion the issue names, and it is what fails if a
 * future filter is added to one path and not the other.
 *
 * @module apps/api/test/integration
 */
import type { IntegrationTestHarness } from './setup';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { createTestOrderRecord } from './fixtures/order.fixtures';
import type { OrderRecordRepositoryPort } from '@openlinker/core/orders';
import { ORDER_RECORD_REPOSITORY_TOKEN } from '@openlinker/core/orders';
import type { CustomerProjectionRepositoryPort } from '@openlinker/core/customers';
import { CustomerProjection } from '@openlinker/core/customers';
import { CUSTOMER_PROJECTION_REPOSITORY_TOKEN } from '@openlinker/core/customers';
import type {
  ProductRepositoryPort,
  ProductVariantRepositoryPort,
} from '@openlinker/core/products';
import {
  PRODUCT_REPOSITORY_TOKEN,
  PRODUCT_VARIANT_REPOSITORY_TOKEN,
} from '@openlinker/core/products';
import type { OfferMappingRepositoryPort } from '@openlinker/core/listings';
import { OFFER_MAPPING_REPOSITORY_TOKEN } from '@openlinker/core/listings';
import { ProductOrmEntity, ProductVariantOrmEntity } from '@openlinker/core/products/orm-entities';
import { IdentifierMappingOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';
import { InventoryItemOrmEntity } from '@openlinker/core/inventory/orm-entities';

const CONNECTION_A = '11111111-1111-4111-8111-111111111111';
const CONNECTION_B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PAGE = { limit: 20, offset: 0 };

describe('Paginated total split (integration, #2944)', () => {
  let harness: IntegrationTestHarness;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  describe('OrderRecordRepository', () => {
    let repository: OrderRecordRepositoryPort;

    beforeAll(() => {
      repository = harness.getApp().get<OrderRecordRepositoryPort>(ORDER_RECORD_REPOSITORY_TOKEN);
    });

    /** Three failed on A, two pending on A, one failed on B. */
    async function seed(): Promise<void> {
      const ds = harness.getDataSource();
      const failed = [{ destinationConnectionId: CONNECTION_B, status: 'failed' as const }];
      const pending = [{ destinationConnectionId: CONNECTION_B, status: 'pending' as const }];
      for (let i = 0; i < 3; i += 1) {
        await createTestOrderRecord(ds, {
          sourceConnectionId: CONNECTION_A,
          syncStatus: failed,
        });
      }
      for (let i = 0; i < 2; i += 1) {
        await createTestOrderRecord(ds, {
          sourceConnectionId: CONNECTION_A,
          syncStatus: pending,
        });
      }
      await createTestOrderRecord(ds, { sourceConnectionId: CONNECTION_B, syncStatus: failed });
    }

    it('agrees with findMany on the total and on the page, unfiltered', async () => {
      await seed();

      const combined = await repository.findMany({}, PAGE);
      const rows = await repository.findManyRows({}, PAGE);
      const total = await repository.countMany({});

      expect(total).toBe(6);
      expect(combined.total).toBe(total);
      expect(rows.map((r) => r.internalOrderId)).toEqual(
        combined.items.map((r) => r.internalOrderId)
      );
    });

    it('moves both paths together when the non-sargable jsonb filter changes', async () => {
      await seed();

      // The `syncStatus @> ...` containment #2843 measured. Changing it must
      // move the count and the page in lockstep - if `countMany` missed this
      // branch the total would stay at 6 while the page showed 4.
      const failedCount = await repository.countMany({ syncStatus: 'failed' });
      const failedPage = await repository.findMany({ syncStatus: 'failed' }, PAGE);
      expect(failedCount).toBe(4);
      expect(failedPage.total).toBe(4);
      expect(failedPage.items).toHaveLength(4);

      const pendingCount = await repository.countMany({ syncStatus: 'pending' });
      const pendingPage = await repository.findMany({ syncStatus: 'pending' }, PAGE);
      expect(pendingCount).toBe(2);
      expect(pendingPage.total).toBe(2);
    });

    it('moves both paths together when a scalar filter changes', async () => {
      await seed();

      const onA = await repository.countMany({ sourceConnectionId: CONNECTION_A });
      const onB = await repository.countMany({ sourceConnectionId: CONNECTION_B });
      expect(onA).toBe(5);
      expect(onB).toBe(1);
      expect((await repository.findMany({ sourceConnectionId: CONNECTION_A }, PAGE)).total).toBe(
        onA
      );
      expect((await repository.findMany({ sourceConnectionId: CONNECTION_B }, PAGE)).total).toBe(
        onB
      );
    });

    it('counts the whole filtered set, not the page', async () => {
      await seed();

      const total = await repository.countMany({});
      const firstPage = await repository.findManyRows({}, { limit: 2, offset: 0 });

      expect(firstPage).toHaveLength(2);
      // The count ignores the page window entirely - that is the property that
      // makes it cacheable per filter combination while paging.
      expect(total).toBe(6);
    });
  });

  describe('CustomerProjectionRepository', () => {
    let repository: CustomerProjectionRepositoryPort;

    beforeAll(() => {
      repository = harness
        .getApp()
        .get<CustomerProjectionRepositoryPort>(CUSTOMER_PROJECTION_REPOSITORY_TOKEN);
    });

    /**
     * Seeded through the repository port rather than an ORM entity: `customers`
     * publishes no `orm-entities` sub-barrel, and minting one for a test's
     * convenience would add public surface no production caller wants.
     */
    async function seed(): Promise<void> {
      const at = (iso: string): Date => new Date(iso);
      await repository.upsert(
        new CustomerProjection(
          'ol_customer_split_1',
          'hash-one',
          'ada@example.com',
          'Ada',
          'Lovelace',
          at('2026-01-01T00:00:00Z'),
          CONNECTION_A,
          at('2026-01-01T00:00:00Z'),
          at('2026-01-01T00:00:00Z')
        )
      );
      await repository.upsert(
        new CustomerProjection(
          'ol_customer_split_2',
          'hash-two',
          'grace@example.com',
          'Grace',
          'Hopper',
          at('2026-01-02T00:00:00Z'),
          CONNECTION_A,
          at('2026-01-02T00:00:00Z'),
          at('2026-01-02T00:00:00Z')
        )
      );
      await repository.upsert(
        new CustomerProjection(
          'ol_customer_split_3',
          'hash-three',
          'alan@example.com',
          'Alan',
          'Turing',
          at('2026-01-03T00:00:00Z'),
          CONNECTION_B,
          at('2026-01-03T00:00:00Z'),
          at('2026-01-03T00:00:00Z')
        )
      );
    }

    it('moves both paths together when the ILIKE search changes', async () => {
      await seed();

      const all = await repository.countMany({});
      expect(all).toBe(3);
      expect((await repository.findMany({}, PAGE)).total).toBe(all);

      // `ILIKE` is the non-sargable shape on this table.
      const searched = await repository.countMany({ search: 'grace' });
      const searchedPage = await repository.findMany({ search: 'grace' }, PAGE);
      expect(searched).toBe(1);
      expect(searchedPage.total).toBe(1);
      expect(
        (await repository.findManyRows({ search: 'grace' }, PAGE)).map((c) => c.internalCustomerId)
      ).toEqual(searchedPage.items.map((c) => c.internalCustomerId));
    });

    it('moves both paths together when the connection filter changes', async () => {
      await seed();

      expect(await repository.countMany({ lastSourceConnectionId: CONNECTION_A })).toBe(2);
      expect(await repository.countMany({ lastSourceConnectionId: CONNECTION_B })).toBe(1);
      expect(
        (await repository.findMany({ lastSourceConnectionId: CONNECTION_A }, PAGE)).total
      ).toBe(2);
    });

    it('combines search AND connection identically on both paths', async () => {
      await seed();

      const filters = { search: 'example.com', lastSourceConnectionId: CONNECTION_A };
      const combined = await repository.findMany(filters, PAGE);
      expect(await repository.countMany(filters)).toBe(combined.total);
      expect(combined.total).toBe(2);
    });
  });

  describe('ProductRepository', () => {
    let repository: ProductRepositoryPort;

    beforeAll(() => {
      repository = harness.getApp().get<ProductRepositoryPort>(PRODUCT_REPOSITORY_TOKEN);
    });

    async function seed(): Promise<void> {
      const repo = harness.getDataSource().getRepository(ProductOrmEntity);
      await repo.save([
        repo.create({ id: 'ol_product_split_1', name: 'Blue Widget', sku: 'BW-1' }),
        repo.create({ id: 'ol_product_split_2', name: 'Red Widget', sku: 'RW-1' }),
        repo.create({ id: 'ol_product_split_3', name: 'Green Gadget', sku: 'GG-1' }),
      ]);
    }

    it('moves both paths together when the ILIKE search changes', async () => {
      await seed();

      expect(await repository.countMany({})).toBe(3);
      expect((await repository.findMany({}, PAGE)).total).toBe(3);

      const widgets = await repository.countMany({ search: 'widget' });
      const widgetPage = await repository.findMany({ search: 'widget' }, PAGE);
      expect(widgets).toBe(2);
      expect(widgetPage.total).toBe(2);
      expect((await repository.findManyRows({ search: 'widget' }, PAGE)).map((p) => p.id)).toEqual(
        widgetPage.items.map((p) => p.id)
      );
    });

    it('answers the same total whatever the sort, since sort cannot narrow', async () => {
      await seed();

      // `countMany` deliberately takes no sort. Its answer must equal the
      // total `findMany` reports under every sort, or omitting it was wrong.
      const unsorted = await repository.findMany({}, PAGE);
      const byName = await repository.findMany({}, PAGE, { field: 'name', dir: 'asc' });
      expect(await repository.countMany({})).toBe(unsorted.total);
      expect(await repository.countMany({})).toBe(byName.total);
    });

    it('agrees on the total when SORTING BY STOCK pulls in the join a count omits', async () => {
      await seed();

      // The one case where `countMany` dropping `sort` is load-bearing rather
      // than tidy. Sorting by stock adds a LEFT JOIN to the grouped
      // inventory subquery; the count builds without it. That is only safe
      // because the join is at most 1:1 (the subquery groups by `productId`),
      // so it cannot change how many rows match - and this asserts that
      // against real SQL rather than against the argument.
      const sortedByStock = await repository.findMany({}, PAGE, {
        field: 'stock',
        dir: 'desc',
      });
      expect(await repository.countMany({})).toBe(sortedByStock.total);
      expect(sortedByStock.total).toBe(3);
    });

    it('moves both paths together when the stock filter changes', async () => {
      await seed();
      // Rows inserted directly rather than through `createTestInventoryItem`:
      // that fixture mints a parent product of its own, which would add rows
      // this block's counts are asserting exact numbers about.
      const inventory = harness.getDataSource().getRepository(InventoryItemOrmEntity);
      await inventory.save([
        inventory.create({
          id: 'ol_inventory_split_1',
          productId: 'ol_product_split_1',
          availableQuantity: 50,
          reservedQuantity: 0,
        }),
        inventory.create({
          id: 'ol_inventory_split_2',
          productId: 'ol_product_split_2',
          availableQuantity: 2,
          reservedQuantity: 0,
        }),
      ]);
      // The third product has no inventory row at all: it joins to NULL and
      // `COALESCE(stock.total, 0)` reads it as out of stock.

      // Each of these predicates is expressed against the joined alias, so the
      // count MUST carry the join. If `buildFilteredQuery` ever stopped adding
      // it for a filter-driven request the count would fail outright, not
      // merely disagree - which is why the filtered path is exercised here and
      // not only the sorted one above.
      for (const stock of ['out', 'low'] as const) {
        const page = await repository.findMany({ stock }, PAGE);
        expect(await repository.countMany({ stock })).toBe(page.total);
        expect(
          (await repository.findManyRows({ stock }, PAGE)).map((p) => p.id)
        ).toEqual(page.items.map((p) => p.id));
      }

      expect(await repository.countMany({ stock: 'low' })).toBe(1);
      expect(await repository.countMany({ stock: 'out' })).toBe(1);
    });
  });

  describe('ProductVariantRepository', () => {
    let repository: ProductVariantRepositoryPort;

    beforeAll(() => {
      repository = harness
        .getApp()
        .get<ProductVariantRepositoryPort>(PRODUCT_VARIANT_REPOSITORY_TOKEN);
    });

    async function seed(): Promise<void> {
      const ds = harness.getDataSource();
      const products = ds.getRepository(ProductOrmEntity);
      await products.save([
        products.create({ id: 'ol_product_var_1', name: 'Parent One', sku: 'P1' }),
        products.create({ id: 'ol_product_var_2', name: 'Parent Two', sku: 'P2' }),
      ]);
      const variants = ds.getRepository(ProductVariantOrmEntity);
      await variants.save([
        variants.create({ id: 'ol_variant_s1', productId: 'ol_product_var_1', sku: 'SKU-AAA' }),
        variants.create({ id: 'ol_variant_s2', productId: 'ol_product_var_1', sku: 'SKU-AAB' }),
        variants.create({ id: 'ol_variant_s3', productId: 'ol_product_var_2', sku: 'SKU-ZZZ' }),
      ]);
    }

    it('moves both paths together for productId and for the ILIKE search', async () => {
      await seed();

      expect(await repository.countMany({})).toBe(3);
      expect(await repository.countMany({ productId: 'ol_product_var_1' })).toBe(2);
      expect((await repository.findMany({ productId: 'ol_product_var_1' }, PAGE)).total).toBe(2);

      const aa = await repository.countMany({ search: 'SKU-AA' });
      const aaPage = await repository.findMany({ search: 'SKU-AA' }, PAGE);
      expect(aa).toBe(2);
      expect(aaPage.total).toBe(2);
      expect((await repository.findManyRows({ search: 'SKU-AA' }, PAGE)).map((v) => v.id)).toEqual(
        aaPage.items.map((v) => v.id)
      );
    });
  });

  describe('OfferMappingRepository', () => {
    let repository: OfferMappingRepositoryPort;

    beforeAll(() => {
      repository = harness.getApp().get<OfferMappingRepositoryPort>(OFFER_MAPPING_REPOSITORY_TOKEN);
    });

    async function seed(): Promise<void> {
      const ds = harness.getDataSource();
      const products = ds.getRepository(ProductOrmEntity);
      await products.save(products.create({ id: 'ol_product_om_1', name: 'Mapped', sku: 'M1' }));
      const variants = ds.getRepository(ProductVariantOrmEntity);
      await variants.save([
        variants.create({ id: 'ol_variant_om_1', productId: 'ol_product_om_1', sku: 'OM-AAA' }),
        variants.create({ id: 'ol_variant_om_2', productId: 'ol_product_om_1', sku: 'OM-BBB' }),
      ]);
      const mappings = ds.getRepository(IdentifierMappingOrmEntity);
      await mappings.save([
        mappings.create({
          entityType: 'Offer',
          internalId: 'ol_variant_om_1',
          externalId: 'ext-offer-1',
          platformType: 'allegro',
          connectionId: CONNECTION_A,
        }),
        mappings.create({
          entityType: 'Offer',
          internalId: 'ol_variant_om_2',
          externalId: 'ext-offer-2',
          platformType: 'allegro',
          connectionId: CONNECTION_A,
        }),
        mappings.create({
          entityType: 'Offer',
          internalId: 'ol_variant_om_1',
          externalId: 'ext-offer-3',
          platformType: 'allegro',
          connectionId: CONNECTION_B,
        }),
      ]);
    }

    it('moves both paths together when the connection filter changes', async () => {
      await seed();

      expect(await repository.countMany({})).toBe(3);
      expect((await repository.findMany({}, PAGE)).total).toBe(3);

      const onA = await repository.countMany({ connectionId: CONNECTION_A });
      const onAPage = await repository.findMany({ connectionId: CONNECTION_A }, PAGE);
      expect(onA).toBe(2);
      expect(onAPage.total).toBe(2);
      expect(
        (await repository.findManyRows({ connectionId: CONNECTION_A }, PAGE)).map((m) => m.id)
      ).toEqual(onAPage.items.map((m) => m.id));
    });

    it('moves both paths together when the ILIKE search changes', async () => {
      await seed();

      const searched = await repository.countMany({ search: 'OM-AAA' });
      const searchedPage = await repository.findMany({ search: 'OM-AAA' }, PAGE);
      // Two mappings point at the variant whose SKU matches.
      expect(searched).toBe(2);
      expect(searchedPage.total).toBe(searched);
    });

    it('honours the lifecycle narrowing on the count, as findMany does', async () => {
      await seed();

      // No status snapshot exists for any of these mappings, so every one is
      // `Unsynced`. `countMany` must apply `lifecycle` - unlike
      // `countByLifecycle`, which partitions the un-narrowed set.
      expect(await repository.countMany({ lifecycle: 'Unsynced' })).toBe(3);
      expect(await repository.countMany({ lifecycle: 'Active' })).toBe(0);
      expect((await repository.findMany({ lifecycle: 'Active' }, PAGE)).total).toBe(0);
    });
  });
});
