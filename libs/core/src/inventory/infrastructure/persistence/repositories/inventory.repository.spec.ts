/**
 * Inventory Repository - Unit Tests
 *
 * Focused coverage of the product-level stock aggregate read (#1720):
 * query-builder wiring (grouping, stale exclusion, parameterisation), the
 * numeric normalisation of Postgres raw rows, and the empty-input
 * short-circuit. Row-level CRUD paths are exercised via integration suites.
 *
 * @module libs/core/src/inventory/infrastructure/persistence/repositories
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  getMetadataArgsStorage,
  QueryFailedError,
  type Repository,
  type SelectQueryBuilder,
} from 'typeorm';

import { InventoryItem } from '../../../domain/entities/inventory-item.entity';
import { InventoryReturningUnsupportedError } from '../../../domain/exceptions/inventory-returning-unsupported.error';
import { InventoryRowVanishedError } from '../../../domain/exceptions/inventory-row-vanished.error';
import { InventoryCrossSourcePositionConflictError } from '../../../domain/exceptions/inventory-cross-source-position-conflict.error';
import { LEGACY_SOURCE_CONNECTION_ID } from '../../../domain/types/inventory.types';
import { InventoryItemOrmEntity } from '../entities/inventory-item.orm-entity';
import {
  INVENTORY_DB_MANAGED_COLUMNS,
  INVENTORY_IDENTITY_COLUMNS,
  INVENTORY_MASTER_OWNED_COLUMNS,
  INVENTORY_OL_OWNED_COLUMNS,
  InventoryRepository,
} from './inventory.repository';

type RawAggregateRow = {
  productId: string;
  totalAvailable: string;
  totalReserved: string;
  stockUpdatedAt: Date | string;
};

/** Chainable query-builder stub capturing the calls the SUT issues. */
function buildQueryBuilderMock(rows: RawAggregateRow[]): jest.Mocked<
  Pick<
    SelectQueryBuilder<InventoryItemOrmEntity>,
    'select' | 'addSelect' | 'where' | 'andWhere' | 'groupBy' | 'getRawMany'
  >
> {
  const qb = {
    select: jest.fn(),
    addSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    groupBy: jest.fn(),
    getRawMany: jest.fn().mockResolvedValue(rows),
  };
  qb.select.mockReturnValue(qb);
  qb.addSelect.mockReturnValue(qb);
  qb.where.mockReturnValue(qb);
  qb.andWhere.mockReturnValue(qb);
  qb.groupBy.mockReturnValue(qb);
  return qb as unknown as jest.Mocked<
    Pick<
      SelectQueryBuilder<InventoryItemOrmEntity>,
      'select' | 'addSelect' | 'where' | 'andWhere' | 'groupBy' | 'getRawMany'
    >
  >;
}

describe('InventoryRepository', () => {
  let repository: InventoryRepository;
  let ormRepository: jest.Mocked<Repository<InventoryItemOrmEntity>>;

  beforeEach(async () => {
    const mockOrmRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      createQueryBuilder: jest.fn(),
      query: jest.fn(),
    } as unknown as jest.Mocked<Repository<InventoryItemOrmEntity>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryRepository,
        {
          provide: getRepositoryToken(InventoryItemOrmEntity),
          useValue: mockOrmRepo,
        },
      ],
    }).compile();

    repository = module.get<InventoryRepository>(InventoryRepository);
    ormRepository = module.get(getRepositoryToken(InventoryItemOrmEntity));
  });

  describe('findDuplicatePositions (#2319)', () => {
    /** Both statements the SUT issues, in call order. */
    function issuedSql(): string[] {
      return (ormRepository.query as jest.Mock).mock.calls.map(
        (call) => (call as [string, unknown[]?])[0]
      );
    }

    it('short-circuits on a clean table without issuing the detail query', async () => {
      (ormRepository.query as jest.Mock).mockResolvedValueOnce([{ groupCount: 0, rowCount: 0 }]);

      const result = await repository.findDuplicatePositions(100);

      expect(result).toEqual({
        groupCount: 0,
        rowCount: 0,
        excessRowCount: 0,
        groups: [],
        truncated: false,
      });
      // Only the totals statement ran — nothing to detail.
      expect(ormRepository.query).toHaveBeenCalledTimes(1);
    });

    it('groups on all FOUR key columns, so cross-source rows are not duplicates', async () => {
      (ormRepository.query as jest.Mock).mockResolvedValueOnce([{ groupCount: 0, rowCount: 0 }]);

      await repository.findDuplicatePositions(100);

      // ADR-058 decision (2): provenance is part of row identity, so a
      // three-column grouping would flag legitimate cross-source coexistence as
      // duplication and permanently block #2325 on a healthy multi-source
      // install. Both statements must carry the same four-column key.
      const fourColumnKey =
        '"productId", "productVariantId", "locationId", "sourceConnectionId"';
      expect(issuedSql()[0]).toContain(`GROUP BY ${fourColumnKey}`);
    });

    it('never restricts rows: the totals statement has no WHERE and no isStale predicate', async () => {
      (ormRepository.query as jest.Mock).mockResolvedValueOnce([{ groupCount: 0, rowCount: 0 }]);

      await repository.findDuplicatePositions(100);

      const totalsSql = issuedSql()[0];
      // A stale duplicate still occupies the position key and still collides
      // under the index #2325 creates. A future refactor that filters stale
      // rows out here would make the gate report "clean" on a table the index
      // cannot be built over — so the absence of any row filter is pinned.
      expect(totalsSql).not.toMatch(/\bWHERE\b/i);
      expect(totalsSql).not.toContain('isStale =');
    });

    it('binds maxGroups as a parameter rather than interpolating it', async () => {
      (ormRepository.query as jest.Mock)
        .mockResolvedValueOnce([{ groupCount: 1, rowCount: 2 }])
        .mockResolvedValueOnce([]);

      await repository.findDuplicatePositions(37);

      const [detailSql, detailParams] = (ormRepository.query as jest.Mock).mock.calls[1] as [
        string,
        unknown[],
      ];
      expect(detailSql).toContain('LIMIT $1');
      expect(detailSql).not.toContain('LIMIT 37');
      expect(detailParams).toEqual([37]);
      // The nullable join columns must match NULL-to-NULL or every locationless
      // / unattributed group silently drops out of the detail.
      expect(detailSql).toContain('IS NOT DISTINCT FROM');
      expect(detailSql).not.toContain('isStale =');
    });

    it('folds contiguous rows into groups and normalises Postgres string numerics', async () => {
      const newer = new Date('2026-05-02T10:00:00Z');
      const older = new Date('2026-05-01T10:00:00Z');
      (ormRepository.query as jest.Mock)
        .mockResolvedValueOnce([{ groupCount: '1', rowCount: '2' }])
        .mockResolvedValueOnce([
          {
            productId: 'prod-1',
            productVariantId: null,
            locationId: null,
            sourceConnectionId: null,
            rowCount: '2',
            liveRowCount: '1',
            id: 'inv-newer',
            availableQuantity: '7',
            reservedQuantity: '0',
            isStale: false,
            updatedAt: newer,
          },
          {
            productId: 'prod-1',
            productVariantId: null,
            locationId: null,
            sourceConnectionId: null,
            rowCount: '2',
            liveRowCount: '1',
            id: 'inv-older',
            availableQuantity: '3',
            reservedQuantity: '1',
            isStale: true,
            // Defensive: the driver hands back Date, but a string must not crash.
            updatedAt: older.toISOString(),
          },
        ]);

      const result = await repository.findDuplicatePositions(100);

      expect(result.groupCount).toBe(1);
      expect(result.rowCount).toBe(2);
      expect(result.excessRowCount).toBe(1);
      expect(result.truncated).toBe(false);
      expect(result.groups).toHaveLength(1);

      const [group] = result.groups;
      expect(group.productId).toBe('prod-1');
      expect(group.productVariantId).toBeNull();
      expect(group.sourceConnectionId).toBeNull();
      expect(group.rowCount).toBe(2);
      // Stale rows are counted in rowCount but not in liveRowCount.
      expect(group.liveRowCount).toBe(1);
      expect(group.rows.map((r) => r.id)).toEqual(['inv-newer', 'inv-older']);
      expect(group.rows[0].availableQuantity).toBe(7);
      expect(group.rows[1].reservedQuantity).toBe(1);
      expect(group.rows[1].isStale).toBe(true);
      expect(group.rows[1].updatedAt).toBeInstanceOf(Date);
      expect(group.rows[1].updatedAt.toISOString()).toBe(older.toISOString());
    });

    it('reports truncated with UNCAPPED totals when detail is capped', async () => {
      // The whole point of the two-statement shape: groupCount is the #2325
      // gate, so it must survive a cap that only shrinks the detail. Three
      // groups exist; maxGroups=1 returns one.
      (ormRepository.query as jest.Mock)
        .mockResolvedValueOnce([{ groupCount: 3, rowCount: 9 }])
        .mockResolvedValueOnce([
          {
            productId: 'prod-1',
            productVariantId: 'var-1',
            locationId: 'loc-1',
            sourceConnectionId: 'conn-1',
            rowCount: 4,
            liveRowCount: 4,
            id: 'inv-1',
            availableQuantity: 1,
            reservedQuantity: 0,
            isStale: false,
            updatedAt: new Date('2026-05-01T00:00:00Z'),
          },
        ]);

      const result = await repository.findDuplicatePositions(1);

      expect(result.groupCount).toBe(3);
      expect(result.rowCount).toBe(9);
      expect(result.excessRowCount).toBe(6);
      expect(result.groups).toHaveLength(1);
      expect(result.truncated).toBe(true);
    });
  });

  describe('backfillLegacyProvenance / countMissingProvenance (#2317)', () => {
    /** The statement the SUT issued, plus its bound parameters. */
    function issued(index = 0): [string, unknown[] | undefined] {
      return (ormRepository.query as jest.Mock).mock.calls[index] as [string, unknown[] | undefined];
    }

    it('issues exactly ONE statement per page', async () => {
      (ormRepository.query as jest.Mock).mockResolvedValueOnce([[], 3]);

      await repository.backfillLegacyProvenance(500);

      // A read-then-write pair would race a live sync between the two halves.
      expect(ormRepository.query).toHaveBeenCalledTimes(1);
    });

    it('never names updatedAt in the statement', async () => {
      (ormRepository.query as jest.Mock).mockResolvedValueOnce([[], 1]);

      await repository.backfillLegacyProvenance(10);

      const [sql] = issued();
      // THE reason this is raw SQL. A query-builder update APPENDS the
      // @UpdateDateColumn stamp (see INVENTORY_DB_MANAGED_COLUMNS), and
      // InventorySyncService derives the propagation dedupe key from that
      // column - a table-wide bump either replays every propagation or collides
      // the keys and drops them silently. This pass changes no stock and must
      // stay invisible to that key.
      expect(sql).not.toContain('updatedAt');
      expect(INVENTORY_DB_MANAGED_COLUMNS).toContain('updatedAt');
    });

    it('sets exactly one column, and that column is the provenance column', async () => {
      (ormRepository.query as jest.Mock).mockResolvedValueOnce([[], 1]);

      await repository.backfillLegacyProvenance(10);

      const [sql] = issued();
      const setClause = /SET([\s\S]*?)WHERE/.exec(sql)?.[1] ?? '';
      expect(setClause).toContain('"sourceConnectionId"');
      // Exactly one assignment - a second would mean a column joined the write
      // set without anyone deciding it should.
      expect(setClause.split('=')).toHaveLength(2);
    });

    it('binds the shared sentinel and the limit as parameters', async () => {
      (ormRepository.query as jest.Mock).mockResolvedValueOnce([[], 1]);

      await repository.backfillLegacyProvenance(250);

      const [sql, params] = issued();
      expect(params).toEqual([LEGACY_SOURCE_CONNECTION_ID, 250]);
      // Neither value is interpolated into the statement text.
      expect(sql).not.toContain("'legacy'");
      expect(sql).not.toContain('250');
    });

    it('filters on IS NULL in BOTH the page sub-select and the outer update', async () => {
      (ormRepository.query as jest.Mock).mockResolvedValueOnce([[], 1]);

      await repository.backfillLegacyProvenance(10);

      const [sql] = issued();
      // The inner predicate picks the page; the outer one re-checks under the
      // row lock, so a row a live sync claimed in between is not stamped back
      // down to the sentinel. The sentinel may only ever LOSE to a real id.
      expect(sql.match(/"sourceConnectionId" IS NULL/g) ?? []).toHaveLength(2);
    });

    it('selects the page with SKIP LOCKED so it never blocks a live stock write', async () => {
      (ormRepository.query as jest.Mock).mockResolvedValueOnce([[], 1]);

      await repository.backfillLegacyProvenance(10);

      const [sql] = issued();
      expect(sql).toContain('FOR UPDATE SKIP LOCKED');
      expect(sql).not.toMatch(/FOR UPDATE(?! SKIP LOCKED)/);
      // Deterministic pages are what let the e2e spec assert a drain sequence.
      expect(sql).toContain('ORDER BY "id"');
    });

    it('reports the affected-row count from the driver tuple', async () => {
      (ormRepository.query as jest.Mock).mockResolvedValueOnce([[], 7]);
      await expect(repository.backfillLegacyProvenance(10)).resolves.toBe(7);
    });

    it('reports zero rather than NaN when the driver returns nothing usable', async () => {
      (ormRepository.query as jest.Mock).mockResolvedValueOnce(undefined);
      await expect(repository.backfillLegacyProvenance(10)).resolves.toBe(0);
    });

    it('counts remaining NULL-provenance rows with no other predicate', async () => {
      (ormRepository.query as jest.Mock).mockResolvedValueOnce([{ remaining: 42 }]);

      await expect(repository.countMissingProvenance()).resolves.toBe(42);

      const [sql] = issued();
      expect(sql).toContain('"sourceConnectionId" IS NULL');
      // Stale rows count too: #2325's SET NOT NULL trips over them identically.
      expect(sql).not.toContain('isStale');
    });

    it('normalises a string COUNT into a number', async () => {
      (ormRepository.query as jest.Mock).mockResolvedValueOnce([{ remaining: '5' }]);
      await expect(repository.countMissingProvenance()).resolves.toBe(5);
    });
  });

  describe('findStockAggregatesByProductIds (#1720)', () => {
    it('returns [] on empty input without touching the query builder', async () => {
      const result = await repository.findStockAggregatesByProductIds([]);

      expect(result).toEqual([]);
      expect(ormRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('groups by productId, excludes stale rows, and casts numeric strings to numbers', async () => {
      const updatedAt = new Date('2026-05-01T12:00:00Z');
      const qb = buildQueryBuilderMock([
        {
          productId: 'prod-1',
          totalAvailable: '12',
          totalReserved: '3',
          stockUpdatedAt: updatedAt,
        },
      ]);
      ormRepository.createQueryBuilder.mockReturnValue(
        qb as unknown as SelectQueryBuilder<InventoryItemOrmEntity>
      );

      const result = await repository.findStockAggregatesByProductIds(['prod-1', 'prod-2']);

      expect(qb.where).toHaveBeenCalledWith('inv.productId IN (:...productIds)', {
        productIds: ['prod-1', 'prod-2'],
      });
      expect(qb.andWhere).toHaveBeenCalledWith('inv.isStale = false');
      expect(qb.groupBy).toHaveBeenCalledWith('inv.productId');
      expect(result).toEqual([
        {
          productId: 'prod-1',
          totalAvailable: 12,
          totalReserved: 3,
          stockUpdatedAt: updatedAt,
        },
      ]);
    });

    it('normalises a string stockUpdatedAt from the driver into a Date', async () => {
      const qb = buildQueryBuilderMock([
        {
          productId: 'prod-1',
          totalAvailable: '0',
          totalReserved: '0',
          stockUpdatedAt: '2026-05-01T12:00:00.000Z',
        },
      ]);
      ormRepository.createQueryBuilder.mockReturnValue(
        qb as unknown as SelectQueryBuilder<InventoryItemOrmEntity>
      );

      const result = await repository.findStockAggregatesByProductIds(['prod-1']);

      expect(result[0].stockUpdatedAt).toEqual(new Date('2026-05-01T12:00:00.000Z'));
    });
  });

  // #2071 — the existing-row write used to be a `save()`, so which columns the
  // master sync could touch was an emergent property of TypeORM's diffing. These
  // pin the write set, on the row every published quantity derives from.
  describe('upsert write set (#2071)', () => {
    const existingRow = {
      id: 'inv-1',
      productId: 'ol_product_1',
      productVariantId: 'ol_variant_1',
      availableQuantity: 1,
      reservedQuantity: 0,
      locationId: null,
      isStale: true,
      sourceConnectionId: 'conn-old',
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    } as InventoryItemOrmEntity;

    const persistedUpdatedAt = new Date('2026-06-02T09:30:00Z');

    /** The SET payload the SUT hands the builder — typed so it is not `any`. */
    type UpdatePayload = Record<string, unknown>;

    /**
     * Chainable stub capturing the SET payload.
     *
     * It serves BOTH statements `upsert` issues, because both go through the
     * same `createQueryBuilder` mock: the provenance-scoped lookup (#2320 — the
     * `incoming` item below carries a connection id, so the lookup no longer
     * takes the `findOne` path) and the column-scoped UPDATE this block is
     * actually about. `getOne` is what decides which upsert branch runs.
     */
    function buildUpdateBuilderMock(found: InventoryItemOrmEntity | null = null): {
      set: jest.Mock<unknown, [UpdatePayload]>;
      where: jest.Mock<unknown, [string, Record<string, unknown>]>;
      returning: jest.Mock<unknown, [string[]]>;
      execute: jest.Mock;
      update: jest.Mock;
      getOne: jest.Mock;
    } {
      const qb = {
        update: jest.fn(),
        set: jest.fn<unknown, [UpdatePayload]>(),
        where: jest.fn<unknown, [string, Record<string, unknown>]>(),
        andWhere: jest.fn(),
        orderBy: jest.fn(),
        addOrderBy: jest.fn(),
        setParameter: jest.fn(),
        getOne: jest.fn().mockResolvedValue(found),
        returning: jest.fn<unknown, [string[]]>(),
        execute: jest
          .fn()
          .mockResolvedValue({ raw: [{ updatedAt: persistedUpdatedAt }], affected: 1 }),
      };
      qb.update.mockReturnValue(qb);
      qb.set.mockReturnValue(qb);
      qb.where.mockReturnValue(qb);
      qb.andWhere.mockReturnValue(qb);
      qb.orderBy.mockReturnValue(qb);
      qb.addOrderBy.mockReturnValue(qb);
      qb.setParameter.mockReturnValue(qb);
      qb.returning.mockReturnValue(qb);
      return qb;
    }

    /**
     * Point BOTH lookup paths at the same answer: `findOne` for an item with no
     * provenance, `getOne` for the scoped builder path a provenance-bearing item
     * takes (#2320). Tests here assert the write, not which path was read.
     */
    function mockLookup(found: InventoryItemOrmEntity | null): ReturnType<
      typeof buildUpdateBuilderMock
    > {
      const qb = buildUpdateBuilderMock(found);
      ormRepository.findOne.mockResolvedValue(found);
      ormRepository.createQueryBuilder.mockReturnValue(
        qb as unknown as ReturnType<typeof ormRepository.createQueryBuilder>
      );
      return qb;
    }

    const incoming = new InventoryItem(
      'ignored-inbound-id',
      'ol_product_1',
      'ol_variant_1',
      7,
      3,
      null,
      new Date('2026-06-02T09:00:00Z'),
      false,
      'conn-new'
    );

    it('should write exactly the master-owned columns, sourced from the item', async () => {
      const qb = mockLookup(existingRow);

      await repository.upsert(incoming);

      const payload = qb.set.mock.calls[0][0];
      // Both directions: no column may be added, and none dropped.
      expect(Object.keys(payload).sort()).toEqual([...INVENTORY_MASTER_OWNED_COLUMNS].sort());
      // Values must round-trip from the item, not merely be present.
      expect(payload).toEqual({
        availableQuantity: 7,
        reservedQuantity: 3,
        isStale: false,
        sourceConnectionId: 'conn-new',
      });
      expect(qb.where).toHaveBeenCalledWith('id = :id', { id: 'inv-1' });
    });

    it('should never write an identity or DB-managed column on the existing-row branch', async () => {
      const qb = mockLookup(existingRow);

      await repository.upsert(incoming);

      const payload = qb.set.mock.calls[0][0];
      for (const column of [
        ...INVENTORY_IDENTITY_COLUMNS,
        // `updatedAt` in particular: naming it suppresses the @UpdateDateColumn
        // stamp that the propagation dedupe key depends on.
        ...INVENTORY_DB_MANAGED_COLUMNS,
      ]) {
        expect(payload).not.toHaveProperty(column);
      }
      expect(ormRepository.save).not.toHaveBeenCalled();
    });

    it('should return the DB-stamped updatedAt rather than the inbound one', async () => {
      const qb = mockLookup(existingRow);

      const result = await repository.upsert(incoming);

      expect(qb.returning).toHaveBeenCalledWith(['updatedAt']);
      expect(result.updatedAt).toEqual(persistedUpdatedAt);
      // Identity comes from the matched row, not the inbound item's id.
      expect(result.id).toBe('inv-1');
      expect(result.availableQuantity).toBe(7);
    });

    it('should throw rather than return a phantom row when the update matches nothing', async () => {
      const qb = mockLookup(existingRow);
      // The row was read, then deleted before the UPDATE ran. `save()` would have
      // re-INSERTed it; a scoped UPDATE cannot, and the old fallback would have
      // returned an item for a row that no longer exists.
      qb.execute.mockResolvedValue({ raw: [], affected: 0 });

      await expect(repository.upsert(incoming)).rejects.toThrow(InventoryRowVanishedError);
    });

    it('should throw when the driver ignores RETURNING rather than using the master timestamp', async () => {
      const qb = mockLookup(existingRow);
      // TypeORM makes `.returning()` a silent no-op on drivers that lack support.
      // Falling back to `item.updatedAt` would put the master-supplied value into
      // the propagation dedupe key — the exact failure this exclusion prevents.
      qb.execute.mockResolvedValue({ raw: [], affected: 1 });

      await expect(repository.upsert(incoming)).rejects.toThrow(InventoryReturningUnsupportedError);
    });

    it('should throw when RETURNING yields a row whose updatedAt is unparseable', async () => {
      const qb = mockLookup(existingRow);
      // The raw key is literally `updatedAt` only because no `namingStrategy` is
      // configured. Under a snake_case strategy the row object stays truthy while
      // the property reads `undefined`, so guarding the ROW is not enough — an
      // unguarded `new Date(undefined)` would sail past as `Invalid Date`.
      qb.execute.mockResolvedValue({ raw: [{ created_at: persistedUpdatedAt }], affected: 1 });

      await expect(repository.upsert(incoming)).rejects.toThrow(InventoryReturningUnsupportedError);
    });

    // The insert branch writes every column, so it has no owned-set to scope —
    // but `updatedAt` is omitted from `toOrmEntity` for the same reason, which
    // means it too can only come back from the database.
    it('should throw when an inserted row comes back without a DB-stamped updatedAt', async () => {
      mockLookup(null);
      ormRepository.save.mockResolvedValue({
        ...existingRow,
        id: '6f1d2b3c-4e5f-4a7b-8c9d-0e1f2a3b4c5d',
        updatedAt: undefined,
      } as unknown as InventoryItemOrmEntity);

      const insertable = new InventoryItem(
        '6f1d2b3c-4e5f-4a7b-8c9d-0e1f2a3b4c5d',
        'ol_product_1',
        'ol_variant_1',
        7,
        3,
        null,
        new Date('2026-06-02T09:00:00Z'),
        false
      );

      await expect(repository.upsert(insertable)).rejects.toThrow(
        InventoryReturningUnsupportedError
      );
    });

    it('should throw on a regenerated-id insert that comes back without updatedAt', async () => {
      // The non-UUID branch strips the caller id and regenerates one; it must
      // carry the same guarantee as its sibling, not just the happy path.
      mockLookup(null);
      ormRepository.create.mockImplementation((v: unknown) => v as InventoryItemOrmEntity);
      ormRepository.save.mockResolvedValue({
        ...existingRow,
        updatedAt: undefined,
      } as unknown as InventoryItemOrmEntity);

      await expect(repository.upsert(incoming)).rejects.toThrow(InventoryReturningUnsupportedError);
    });

    // ---- ADR-058 ladder step (i): provenance + the OL-owned group (#2314) ----

    it('should never write an OL-owned column on the existing-row branch', async () => {
      const qb = mockLookup(existingRow);

      await repository.upsert(incoming);

      const payload = qb.set.mock.calls[0][0];
      for (const column of INVENTORY_OL_OWNED_COLUMNS) {
        expect(payload).not.toHaveProperty(column);
      }
      // The loop above is vacuous today, and deliberately so: the group is empty
      // until `olReservedQuantity` lands (ADR-061, Wave 2). Pinning the emptiness
      // makes this assertion start doing real work on the same commit that fills
      // the group, rather than passing silently forever.
      expect(INVENTORY_OL_OWNED_COLUMNS).toEqual([]);
    });

    it('should keep the four column groups disjoint', () => {
      const all = [
        ...INVENTORY_IDENTITY_COLUMNS,
        ...INVENTORY_MASTER_OWNED_COLUMNS,
        ...INVENTORY_DB_MANAGED_COLUMNS,
        ...INVENTORY_OL_OWNED_COLUMNS,
      ];

      // Classification says "exactly one group"; the sibling spec proves total
      // coverage, this one proves no column is claimed twice — a column in both
      // the master-owned and OL-owned sets would type-check and silently make
      // the master the writer of an OL-owned value.
      expect(new Set(all).size).toBe(all.length);
    });

    it('should write the incoming provenance on the existing-row branch and carry it back', async () => {
      const qb = mockLookup(existingRow);

      const result = await repository.upsert(incoming);

      // The row already carried 'conn-old'. Provenance is in the UPDATE set on
      // purpose, so the syncing connection stamps its own id — this is what lets
      // a pre-existing row acquire provenance without waiting for #2317.
      expect(qb.set.mock.calls[0][0]).toHaveProperty('sourceConnectionId', 'conn-new');
      expect(result.sourceConnectionId).toBe('conn-new');
    });

    it('should write provenance on the insert branch and carry it back', async () => {
      const stampedAt = new Date('2026-06-02T09:30:00Z');
      mockLookup(null);
      ormRepository.save.mockImplementation((v: unknown) =>
        Promise.resolve({ ...(v as InventoryItemOrmEntity), updatedAt: stampedAt })
      );

      const insertable = new InventoryItem(
        '6f1d2b3c-4e5f-4a7b-8c9d-0e1f2a3b4c5d',
        'ol_product_1',
        'ol_variant_1',
        7,
        3,
        null,
        new Date('2026-06-02T09:00:00Z'),
        false,
        'conn-new'
      );

      const result = await repository.upsert(insertable);

      const saved = ormRepository.save.mock.calls[0][0] as InventoryItemOrmEntity;
      expect(saved.sourceConnectionId).toBe('conn-new');
      expect(result.sourceConnectionId).toBe('conn-new');
    });

    it('should write provenance on the regenerated-id insert sub-branch too', async () => {
      // The non-UUID branch rebuilds the entity through `create({...rest, id})`;
      // a column dropped by that destructure would be lost silently.
      const stampedAt = new Date('2026-06-02T09:30:00Z');
      mockLookup(null);
      ormRepository.create.mockImplementation((v: unknown) => v as InventoryItemOrmEntity);
      ormRepository.save.mockImplementation((v: unknown) =>
        Promise.resolve({ ...(v as InventoryItemOrmEntity), updatedAt: stampedAt })
      );

      const result = await repository.upsert(incoming);

      const created = ormRepository.create.mock.calls[0][0] as InventoryItemOrmEntity;
      expect(created.sourceConnectionId).toBe('conn-new');
      expect(result.sourceConnectionId).toBe('conn-new');
    });

    it('should persist a null provenance rather than inventing one', async () => {
      // A caller with no connection axis is legal until the #2317 backfill;
      // NULL must reach the row as NULL, not be coerced to a placeholder.
      const stampedAt = new Date('2026-06-02T09:30:00Z');
      mockLookup(null);
      ormRepository.save.mockImplementation((v: unknown) =>
        Promise.resolve({ ...(v as InventoryItemOrmEntity), updatedAt: stampedAt })
      );

      const unattributed = new InventoryItem(
        '6f1d2b3c-4e5f-4a7b-8c9d-0e1f2a3b4c5d',
        'ol_product_1',
        'ol_variant_1',
        7,
        3,
        null,
        new Date('2026-06-02T09:00:00Z'),
        false
      );

      const result = await repository.upsert(unattributed);

      expect((ormRepository.save.mock.calls[0][0] as InventoryItemOrmEntity).sourceConnectionId).
        toBeNull();
      expect(result.sourceConnectionId).toBeNull();
    });

    // The guard that actually earns its keep: adding a column to the ORM entity
    // fails here until it is classified, instead of silently joining the write
    // set. Same "must be updated deliberately" shape as route-lazy.test.ts's
    // expected-count assertion.
    it('should classify every declared entity column into exactly one group', () => {
      const declared = getMetadataArgsStorage()
        .columns.filter((column) => column.target === InventoryItemOrmEntity)
        .map((column) => column.propertyName)
        .sort();

      const classified = [
        ...INVENTORY_IDENTITY_COLUMNS,
        ...INVENTORY_MASTER_OWNED_COLUMNS,
        ...INVENTORY_DB_MANAGED_COLUMNS,
        ...INVENTORY_OL_OWNED_COLUMNS,
      ].sort();

      expect(declared).toEqual(classified);
    });
  });

  describe('provenance-scoped lookup and prune (#2320)', () => {
    /** Chainable select-builder stub recording every predicate the SUT adds. */
    function buildScopedSelectMock(found: InventoryItemOrmEntity | null): Record<string, jest.Mock> {
      const qb: Record<string, jest.Mock> = {
        where: jest.fn(),
        andWhere: jest.fn(),
        orderBy: jest.fn(),
        addOrderBy: jest.fn(),
        setParameter: jest.fn(),
        getOne: jest.fn().mockResolvedValue(found),
      };
      for (const key of ['where', 'andWhere', 'orderBy', 'addOrderBy', 'setParameter']) {
        qb[key].mockReturnValue(qb);
      }
      return qb;
    }

    /** Chainable update-builder stub for the prune path. */
    function buildPruneMock(): Record<string, jest.Mock> {
      const qb: Record<string, jest.Mock> = {
        update: jest.fn(),
        set: jest.fn(),
        where: jest.fn(),
        andWhere: jest.fn(),
        returning: jest.fn(),
        execute: jest.fn().mockResolvedValue({ raw: [], affected: 0 }),
      };
      for (const key of ['update', 'set', 'where', 'andWhere', 'returning']) {
        qb[key].mockReturnValue(qb);
      }
      return qb;
    }

    /** Renders a `Brackets` argument to SQL so its shape can be asserted. */
    function renderBrackets(brackets: unknown): { sql: string[]; params: Record<string, unknown> } {
      const sql: string[] = [];
      const params: Record<string, unknown> = {};
      const inner: {
        where: (condition: string, p?: Record<string, unknown>) => unknown;
        orWhere: (condition: string, p?: Record<string, unknown>) => unknown;
      } = {
        where: (condition, p) => {
          sql.push(condition);
          Object.assign(params, p ?? {});
          return inner;
        },
        orWhere: (condition, p) => {
          sql.push(condition);
          Object.assign(params, p ?? {});
          return inner;
        },
      };
      (brackets as { whereFactory: (qb: unknown) => void }).whereFactory(inner);
      return { sql, params };
    }

    /** The last `andWhere` argument — the provenance group is always appended last. */
    function lastBracket(qb: Record<string, jest.Mock>): unknown {
      const calls = qb.andWhere.mock.calls as unknown[][];
      return calls[calls.length - 1][0];
    }

    const row = {
      id: 'inv-own',
      productId: 'ol_product_1',
      productVariantId: 'ol_variant_1',
      availableQuantity: 4,
      reservedQuantity: 0,
      locationId: null,
      isStale: false,
      sourceConnectionId: 'conn-alpha',
      updatedAt: new Date('2026-06-02T09:30:00Z'),
    } as InventoryItemOrmEntity;

    it('keeps the exact unscoped findOne path when no provenance axis is given', async () => {
      ormRepository.findOne.mockResolvedValue(row);

      await repository.findByProductAndVariant('ol_product_1', 'ol_variant_1', null);

      expect(ormRepository.createQueryBuilder).not.toHaveBeenCalled();
      expect(ormRepository.findOne).toHaveBeenCalledWith({
        where: { productId: 'ol_product_1', productVariantId: 'ol_variant_1', locationId: null },
      });
    });

    // The asymmetry that keeps the #2314 in-place-claim spec passing: for the
    // provenance axis `null` means "no axis", NOT "provenance IS NULL".
    it('treats a null provenance axis as unscoped, not as "provenance IS NULL"', async () => {
      ormRepository.findOne.mockResolvedValue(row);

      await repository.findByProductAndVariant('ol_product_1', 'ol_variant_1', null, null);

      expect(ormRepository.createQueryBuilder).not.toHaveBeenCalled();
      expect(ormRepository.findOne).toHaveBeenCalledTimes(1);
    });

    it('matches own-or-unattributed provenance and prefers the connection own row', async () => {
      const qb = buildScopedSelectMock(row);
      ormRepository.createQueryBuilder.mockReturnValue(
        qb as unknown as ReturnType<typeof ormRepository.createQueryBuilder>
      );

      const found = await repository.findByProductAndVariant(
        'ol_product_1',
        'ol_variant_1',
        null,
        'conn-alpha'
      );

      expect(found?.id).toBe('inv-own');
      expect(ormRepository.findOne).not.toHaveBeenCalled();

      const { sql, params } = renderBrackets(lastBracket(qb));
      expect(sql).toEqual([
        'inv."sourceConnectionId" = :scopeConnectionId',
        'inv."sourceConnectionId" IS NULL',
        'inv."sourceConnectionId" = :legacyProvenance',
      ]);
      expect(params).toEqual({
        scopeConnectionId: 'conn-alpha',
        legacyProvenance: LEGACY_SOURCE_CONNECTION_ID,
      });

      // Deterministic: own provenance first, `id` breaking the remaining tie.
      expect(qb.orderBy).toHaveBeenCalledWith(
        'CASE WHEN inv."sourceConnectionId" = :ownConnectionId THEN 0 ELSE 1 END',
        'ASC'
      );
      expect(qb.setParameter).toHaveBeenCalledWith('ownConnectionId', 'conn-alpha');
      expect(qb.addOrderBy).toHaveBeenCalledWith('inv.id', 'ASC');
    });

    it('derives the upsert lookup axis from the item provenance', async () => {
      const qb = buildScopedSelectMock(null);
      ormRepository.createQueryBuilder.mockReturnValue(
        qb as unknown as ReturnType<typeof ormRepository.createQueryBuilder>
      );
      ormRepository.save.mockResolvedValue({
        ...row,
        id: '11111111-1111-4111-8111-111111111111',
      } as never);

      await repository.upsert(
        new InventoryItem(
          '11111111-1111-4111-8111-111111111111',
          'ol_product_1',
          'ol_variant_1',
          9,
          0,
          null,
          new Date(),
          false,
          'conn-beta'
        )
      );

      expect(renderBrackets(lastBracket(qb)).params).toMatchObject({
        scopeConnectionId: 'conn-beta',
      });
    });

    it('translates a position unique violation into the typed cross-source error', async () => {
      const qb = buildScopedSelectMock(null);
      ormRepository.createQueryBuilder.mockReturnValue(
        qb as unknown as ReturnType<typeof ormRepository.createQueryBuilder>
      );
      // A hash-named index, as `synchronize` mints it — the translation must
      // not depend on the migration's descriptive name.
      const positionError = new Error(
        'duplicate key value violates unique constraint "IDX_9c1f2a"'
      ) as Error & { code?: string; detail?: string };
      positionError.code = '23505';
      positionError.detail =
        'Key ("productId", "productVariantId", "locationId")=(ol_product_1, ol_variant_1, loc-1) already exists.';
      ormRepository.save.mockRejectedValue(new QueryFailedError('INSERT', [], positionError));

      await expect(
        repository.upsert(
          new InventoryItem(
            '11111111-1111-4111-8111-111111111111',
            'ol_product_1',
            'ol_variant_1',
            9,
            0,
            'loc-1',
            new Date(),
            false,
            'conn-beta'
          )
        )
      ).rejects.toBeInstanceOf(InventoryCrossSourcePositionConflictError);
    });

    // I2 — the translation matches only the two NAMED position indexes. A bare
    // `duplicate key` alternative matched every unique violation on the table,
    // primary-key collisions included, and dressed them as a PERMANENT,
    // non-retryable cross-source conflict that describes something that did
    // not happen.
    it('does not translate an unrelated unique violation into a cross-source conflict', async () => {
      const qb = buildScopedSelectMock(null);
      ormRepository.createQueryBuilder.mockReturnValue(
        qb as unknown as ReturnType<typeof ormRepository.createQueryBuilder>
      );
      // A PRIMARY-KEY collision: unique, but not the position key. Postgres
      // reports the offending COLUMNS in `detail`, and here they are `(id)` —
      // which is what discriminates, since a synchronize-built schema names
      // the position indexes `IDX_<hash>` rather than descriptively.
      const pkError = new Error(
        'duplicate key value violates unique constraint "PK_inventory_items"'
      ) as Error & { code?: string; detail?: string };
      pkError.code = '23505';
      pkError.detail = 'Key (id)=(11111111-1111-4111-8111-111111111111) already exists.';
      const unrelated = new QueryFailedError('INSERT', [], pkError);
      ormRepository.save.mockRejectedValue(unrelated);

      await expect(
        repository.upsert(
          new InventoryItem(
            '11111111-1111-4111-8111-111111111111',
            'ol_product_1',
            'ol_variant_1',
            9,
            0,
            'loc-1',
            new Date(),
            false,
            'conn-beta'
          )
        )
      ).rejects.toBe(unrelated);
    });

    it('adds no provenance predicate to an unscoped prune, and a bracketed one when scoped', async () => {
      const unscoped = buildPruneMock();
      ormRepository.createQueryBuilder.mockReturnValue(
        unscoped as unknown as ReturnType<typeof ormRepository.createQueryBuilder>
      );
      await repository.markStaleExceptVariants('ol_product_1', ['ol_variant_1']);
      const unscopedCalls = unscoped.andWhere.mock.calls.length;

      const scoped = buildPruneMock();
      ormRepository.createQueryBuilder.mockReturnValue(
        scoped as unknown as ReturnType<typeof ormRepository.createQueryBuilder>
      );
      await repository.markStaleExceptVariants('ol_product_1', ['ol_variant_1'], {
        sourceConnectionId: 'conn-alpha',
        includeUnattributedProvenance: true,
      });

      // Exactly one predicate more than the unscoped sweep, and it is the
      // bracketed provenance group — an unbracketed OR here would re-associate
      // with the variant-keep group and stale another connection's rows.
      expect(scoped.andWhere.mock.calls).toHaveLength(unscopedCalls + 1);
      expect(renderBrackets(lastBracket(scoped)).sql).toEqual([
        '"sourceConnectionId" = :scopeConnectionId',
        '"sourceConnectionId" IS NULL',
        '"sourceConnectionId" = :legacyProvenance',
      ]);
    });

    it('omits the unattributed arm when the scope claims strictly its own rows', async () => {
      const qb = buildPruneMock();
      ormRepository.createQueryBuilder.mockReturnValue(
        qb as unknown as ReturnType<typeof ormRepository.createQueryBuilder>
      );

      await repository.markStaleExceptVariants('ol_product_1', [], {
        sourceConnectionId: 'conn-alpha',
        includeUnattributedProvenance: false,
      });

      expect(renderBrackets(lastBracket(qb)).sql).toEqual([
        '"sourceConnectionId" = :scopeConnectionId',
      ]);
    });

    // ADR-058 decision (2) enforcement (#2322).
    describe('markLocationlessStaleForSource', () => {
      /**
       * RAW SQL since the boundary review (#2320 follow-up): a query-builder
       * update auto-appends the `@UpdateDateColumn`, so the method's stated
       * "no updatedAt bump" invariant was FALSE while it used one. These specs
       * therefore assert against `repository.query` — and the first of them
       * asserts the SET clause names exactly `isStale`, which is the whole
       * point of the conversion.
       */
      const lastQuery = (): [string, unknown[]] => {
        const calls = (ormRepository.query as jest.Mock).mock.calls;
        return calls[calls.length - 1] as [string, unknown[]];
      };

      const normalise = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

      it('touches storage not at all when nothing was located', async () => {
        const result = await repository.markLocationlessStaleForSource('ol_product_1', [], {
          sourceConnectionId: 'conn-alpha',
          includeUnattributedProvenance: true,
        });

        expect(ormRepository.query).not.toHaveBeenCalled();
        expect(ormRepository.createQueryBuilder).not.toHaveBeenCalled();
        expect(result).toEqual({ markedCount: 0, variantIds: [] });
      });

      it('stamps ONLY isStale — never updatedAt — and never uses the query builder', async () => {
        (ormRepository.query as jest.Mock).mockResolvedValueOnce([]);

        await repository.markLocationlessStaleForSource(
          'ol_product_1',
          ['ol_variant_1', 'ol_variant_2'],
          { sourceConnectionId: 'conn-alpha', includeUnattributedProvenance: true }
        );

        const [sql] = lastQuery();
        // The SET clause names exactly one column. A query-builder update
        // would silently add `updatedAt`, which `InventorySyncService` uses to
        // derive the propagation dedupe key and #2321 reports as when stock
        // was last OBSERVED — so the bump is not cosmetic.
        expect(normalise(sql)).toContain('SET "isStale" = true WHERE');
        expect(sql).not.toContain('updatedAt');
        expect(ormRepository.createQueryBuilder).not.toHaveBeenCalled();
      });

      it('restricts to pooled rows of the located variants, scoped to this source', async () => {
        (ormRepository.query as jest.Mock).mockResolvedValueOnce([]);

        await repository.markLocationlessStaleForSource(
          'ol_product_1',
          ['ol_variant_1', 'ol_variant_2'],
          { sourceConnectionId: 'conn-alpha', includeUnattributedProvenance: true }
        );

        const [sql, params] = lastQuery();
        const flat = normalise(sql);

        expect(flat).toContain('"productId" = $1');
        expect(flat).toContain('"isStale" = false');
        // The pooled half of the rule: a row AT a location IS the located write.
        expect(flat).toContain('"locationId" IS NULL');
        // Array membership over guaranteed-non-null values only.
        expect(flat).toContain('("productVariantId" = ANY($2::text[]))');
        // Provenance group is its OWN parenthesised group, so the two ORs
        // cannot re-associate into a predicate that stales a rival's rows.
        expect(flat).toContain(
          '("sourceConnectionId" = $3 OR "sourceConnectionId" IS NULL OR "sourceConnectionId" = $4)'
        );
        expect(flat).toContain('RETURNING "productVariantId"');
        // Nothing interpolated — every value is bound.
        expect(params).toEqual([
          'ol_product_1',
          ['ol_variant_1', 'ol_variant_2'],
          'conn-alpha',
          'legacy',
        ]);
      });

      it('carries a product-level located position as its own NULL-guarded arm', async () => {
        (ormRepository.query as jest.Mock).mockResolvedValueOnce([]);

        await repository.markLocationlessStaleForSource('ol_product_1', ['ol_variant_1', null], {
          sourceConnectionId: 'conn-alpha',
          includeUnattributedProvenance: true,
        });

        const [sql] = lastQuery();
        expect(normalise(sql)).toContain(
          '("productVariantId" = ANY($2::text[]) OR "productVariantId" IS NULL)'
        );
      });

      it('drops the unattributed arm when the scope claims strictly its own rows', async () => {
        (ormRepository.query as jest.Mock).mockResolvedValueOnce([]);

        await repository.markLocationlessStaleForSource('ol_product_1', ['ol_variant_1'], {
          sourceConnectionId: 'conn-alpha',
          includeUnattributedProvenance: false,
        });

        const [sql, params] = lastQuery();
        const flat = normalise(sql);
        expect(flat).toContain('("sourceConnectionId" = $3)');
        expect(flat).not.toContain('"sourceConnectionId" IS NULL');
        expect(params).toEqual(['ol_product_1', ['ol_variant_1'], 'conn-alpha']);
      });

      it('reports the distinct non-null variant ids it flagged', async () => {
        (ormRepository.query as jest.Mock).mockResolvedValueOnce([
          { productVariantId: 'ol_variant_1' },
          { productVariantId: 'ol_variant_1' },
          { productVariantId: null },
        ]);

        const result = await repository.markLocationlessStaleForSource(
          'ol_product_1',
          ['ol_variant_1', null],
          { sourceConnectionId: 'conn-alpha', includeUnattributedProvenance: true }
        );

        // `markedProductLevel` is what lets the caller keep the product-level
        // propagation target on a MIXED result: `variantIds` cannot carry the
        // NULL, so without the flag that target is silently dropped.
        expect(result).toEqual({
          markedCount: 3,
          variantIds: ['ol_variant_1'],
          markedProductLevel: true,
        });
      });

      it('reports markedProductLevel false when only variant-keyed rows were staled', async () => {
        (ormRepository.query as jest.Mock).mockResolvedValueOnce([
          { productVariantId: 'ol_variant_1' },
        ]);

        const result = await repository.markLocationlessStaleForSource(
          'ol_product_1',
          ['ol_variant_1'],
          { sourceConnectionId: 'conn-alpha', includeUnattributedProvenance: true }
        );

        expect(result).toEqual({
          markedCount: 1,
          variantIds: ['ol_variant_1'],
          markedProductLevel: false,
        });
      });
    });

    it('applies the read filter with strict equality, never the claim rule', async () => {
      ormRepository.findAndCount.mockResolvedValue([[], 0]);

      await repository.findMany(
        { productId: 'ol_product_1', sourceConnectionId: 'conn-alpha' },
        { limit: 10, offset: 0 }
      );

      expect(ormRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { productId: 'ol_product_1', sourceConnectionId: 'conn-alpha' },
        })
      );
    });
  });
});
