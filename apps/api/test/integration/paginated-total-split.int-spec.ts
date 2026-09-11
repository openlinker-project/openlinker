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

  // BEFORE each case, not only after (CI, #2957). `jest-integration.cjs` runs
  // `maxWorkers: 1` against ONE Postgres started in `globalSetup`, so all 25
  // int-spec files share a database and run in sequence. An `afterEach`-only
  // reset leaves this file's FIRST case reading whatever the previous FILE left
  // behind - which is exactly how `expect(total).toBe(6)` met 10 on CI while
  // passing locally, where the file was run alone. Resetting on both edges
  // makes every absolute count in this suite a property of its own seed.
  beforeEach(async () => {
    await resetTestHarness();
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

      // The AGREEMENT this case is named for, which needs no absolute at all.
      // It is not a tautology on this repository, unlike `ProductRepository`:
      // `findMany` ends in `getManyAndCount()` and `countMany` in `getCount()`,
      // two different statements over two builders, so the two answering alike
      // is the property under test.
      expect(combined.total).toBe(total);
      expect(rows.map((r) => r.internalOrderId)).toEqual(
        combined.items.map((r) => r.internalOrderId)
      );
      // And the seed's own six, so a reset that stopped working is still loud
      // rather than silently making every assertion above vacuous against an
      // empty table.
      expect(total).toBe(6);
    });

    it('windows the rows-only read at the offset it was given', async () => {
      await seed();

      // Every `withTotal=false` assertion in the repo passed `offset: 0`, so
      // `{ limit, offset }` -> `{ limit, offset: 0 }` survived the whole suite
      // (#2957 review round 6, I5) - page 2 would show page 1's rows under a
      // correct total. Proved here against real SQL rather than a mock's
      // arguments, and the pages must not overlap.
      //
      // The DEPTH assertions below carry the weight rather than the non-overlap
      // one (#2957 review round 7, S4): the default sort is
      // `ORDER BY rec."createdAt" DESC` with no tiebreaker - the one branch of
      // eight without the `addOrderBy('rec.createdAt','DESC')` its siblings
      // carry - so with equal timestamps the row ORDER is heap order. Counting
      // rows per window needs no ordering at all, and a hardcoded `offset: 0`
      // makes the last window return rows where it must return none.
      const first = await repository.findManyRows({}, { limit: 2, offset: 0 });
      const second = await repository.findManyRows({}, { limit: 2, offset: 2 });

      expect(first).toHaveLength(2);
      expect(second).toHaveLength(2);
      const firstIds = first.map((r) => r.internalOrderId);
      const secondIds = second.map((r) => r.internalOrderId);
      expect(secondIds.some((id) => firstIds.includes(id))).toBe(false);
      // And the same window the combined read returns for that offset.
      const combined = await repository.findMany({}, { limit: 2, offset: 2 });
      expect(secondIds).toEqual(combined.items.map((r) => r.internalOrderId));

      // Order-independent, and the assertion a hardcoded `offset: 0` cannot
      // survive: six rows seeded, so a window starting at six holds none.
      expect(await repository.findManyRows({}, { limit: 2, offset: 4 })).toHaveLength(2);
      expect(await repository.findManyRows({}, { limit: 2, offset: 6 })).toHaveLength(0);
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

  /**
   * Note what parity means for THIS repository (#2957 review, SUGGESTION 5).
   *
   * `ProductRepository.findMany` is literally
   * `Promise.all([findManyRows, countMany])`, so "the split agrees with the
   * combined read" is structural here and a `findMany` vs `findManyRows`
   * assertion restates its own implementation. What carries weight below is
   * the ABSOLUTE numbers and the sort/join cases - the questions composition
   * does not answer.
   */
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
      // No `findManyRows` vs `findMany.items` comparison here: on THIS
      // repository the second is literally the first, so it restates its own
      // implementation (#2957 review round 4, S5). The absolute counts above
      // are what carry weight.
      expect((await repository.findManyRows({ search: 'widget' }, PAGE)).map((p) => p.id)).toEqual([
        'ol_product_split_1',
        'ol_product_split_2',
      ]);
    });

    it('answers the same total whatever the sort, since sort cannot narrow', async () => {
      await seed();

      // Absolute numbers, not cross-path equality (#2957 review round 4, I1).
      // `ProductRepository.findMany` IS `Promise.all([findManyRows, countMany])`,
      // so `findMany(...).total === countMany(...)` is the same call twice and
      // cannot fail. Three products exist; every sort must still see three.
      expect((await repository.findMany({}, PAGE)).total).toBe(3);
      expect((await repository.findMany({}, PAGE, { field: 'name', dir: 'asc' })).total).toBe(3);
      expect((await repository.findMany({}, PAGE, { field: 'sku', dir: 'desc' })).total).toBe(3);
      expect(await repository.countMany({})).toBe(3);
    });

    it('agrees on the total when SORTING BY STOCK pulls in the join a count omits', async () => {
      await seed();

      // The one case where `countMany` dropping `sort` is load-bearing rather
      // than tidy. Sorting by stock adds a LEFT JOIN to the grouped
      // inventory subquery; the count builds without it. That is only safe
      // because the join is at most 1:1 (the subquery groups by `productId`),
      // so it cannot change how many rows match.
      //
      // The join needs rows that COULD multiply, or the test cannot observe the
      // property it names: against an empty `inventory_items` a 1:N join and a
      // 1:1 join are indistinguishable. So one product gets TWO positions.
      //
      // The mutation this catches is replacing the GROUPED subquery with a bare
      // join on `inventory_items` - not "delete the `GROUP BY`", which an
      // earlier version of this comment named and which Postgres rejects
      // outright with 42803 (#2957 review round 4). Verified by making it: the
      // read returns two products where three exist.
      //
      // `productVariantId` carries a real FK to `product_variants`
      // (`inventory-item.orm-entity.ts` declares the `@ManyToOne`, and the
      // harness builds schema by `synchronize`, which emits it), so the
      // variants must exist first - #2957 review round 3, B1: an earlier
      // version of this block inserted the positions alone and could not run
      // at all.
      const variants = harness.getDataSource().getRepository(ProductVariantOrmEntity);
      await variants.save([
        variants.create({ id: 'ol_variant_join_a', productId: 'ol_product_split_1' }),
        variants.create({ id: 'ol_variant_join_b', productId: 'ol_product_split_1' }),
      ]);
      const inventory = harness.getDataSource().getRepository(InventoryItemOrmEntity);
      await inventory.save([
        inventory.create({
          id: 'ol_inventory_join_1',
          productId: 'ol_product_split_1',
          productVariantId: 'ol_variant_join_a',
          availableQuantity: 7,
          reservedQuantity: 0,
        }),
        inventory.create({
          id: 'ol_inventory_join_2',
          productId: 'ol_product_split_1',
          productVariantId: 'ol_variant_join_b',
          availableQuantity: 5,
          reservedQuantity: 0,
        }),
      ]);

      // Read a page NARROWER than the row count, which is what makes a 1:N join
      // observable (#2957 review round 3, I2). `getMany()` collapses duplicate
      // raw rows to one entity per primary key, so at a page of 20 a broken
      // `GROUP BY` yields four raw rows, three entities, and every assertion
      // passes. At a page of 3 the LIMIT truncates the raw rows first: four
      // become three, two of which are the same product, and the read returns
      // TWO products where the correct query returns three.
      const narrowPage = { limit: 3, offset: 0 };
      const sortedByStock = await repository.findMany({}, narrowPage, {
        field: 'stock',
        dir: 'desc',
      });
      expect(sortedByStock.items).toHaveLength(3);
      expect(new Set(sortedByStock.items.map((p) => p.id)).size).toBe(3);

      // The count builds no join at all, because it takes no sort. Asserted as
      // an absolute: `sortedByStock.total` IS `countMany({})` on this
      // repository, so comparing the two is one call against itself.
      expect(await repository.countMany({})).toBe(3);
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
        expect((await repository.findManyRows({ stock }, PAGE)).map((p) => p.id)).toEqual(
          page.items.map((p) => p.id)
        );
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

      // And the two ROUTES that answer the same number must agree (#2957
      // review, SUGGESTION 7). `GET /listings/count` without the buckets goes
      // through `countMany({lifecycle})`; with them it reads the bucket. Two
      // different SQL predicates for one question, reachable by one client a
      // request apart - so assert them against each other directly rather than
      // leaving it to the transitive bucket-sums-to-page-rows check elsewhere.
      const buckets = await repository.countByLifecycle({});
      for (const lifecycle of ['Unsynced', 'Active', 'Draft', 'Invalid', 'Ended'] as const) {
        expect(await repository.countMany({ lifecycle })).toBe(buckets[lifecycle]);
      }
    });
  });
});
