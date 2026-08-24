/**
 * Inventory Repository
 *
 * Repository implementation for inventory persistence operations.
 * Provides data access methods for finding and upserting inventory items,
 * with conversion between domain entities and ORM entities.
 *
 * Implements InventoryRepositoryPort to maintain proper dependency
 * direction and enable easy testing/mocking.
 *
 * The update path is column-scoped (#2071): the four exported column groups
 * below state which columns the master sync owns, and a spec asserts every
 * declared entity column is classified into exactly one of them — so a column
 * added later cannot silently join the write set on the row every published
 * quantity derives from.
 *
 * @module libs/core/src/inventory/infrastructure/persistence/repositories
 * @implements {InventoryRepositoryPort}
 * @see {@link InventoryItemOrmEntity} for the database entity
 * @see {@link InventoryRepositoryPort} for the port interface
 */
import { Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, QueryFailedError, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { InventoryItemOrmEntity } from '../entities/inventory-item.orm-entity';
import type { InventoryRepositoryPort } from '../../../domain/ports/inventory-repository.port';
import { InventoryItem } from '../../../domain/entities/inventory-item.entity';
import { InventoryReturningUnsupportedError } from '../../../domain/exceptions/inventory-returning-unsupported.error';
import { InventoryRowVanishedError } from '../../../domain/exceptions/inventory-row-vanished.error';
import { InventoryCrossSourcePositionConflictError } from '../../../domain/exceptions/inventory-cross-source-position-conflict.error';
import { LEGACY_SOURCE_CONNECTION_ID } from '../../../domain/types/inventory.types';
import type {
  InventoryFilters,
  InventoryPagination,
  PaginatedInventoryItems,
  VariantAvailability,
  ProductStockAggregate,
  PruneStaleVariantsResult,
  ProvenanceScope,
  DuplicatePositionReport,
  DuplicatePositionGroup,
} from '../../../domain/types/inventory.types';

/**
 * The four column groups below are exported for the classification spec, which
 * asserts every declared entity column falls into exactly one of them — so a new
 * column fails the build until someone decides who owns it. They are NOT part of
 * the context's public surface (deliberately absent from `inventory/index.ts`)
 * and no caller should read them.
 */

/**
 * Columns that identify an `inventory_items` row (#2071).
 *
 * `findByProductAndVariant` matches on the last three, so these ARE the lookup
 * key: writing them back on an update is a no-op at best and a row-identity
 * change at worst. Never in an update's SET clause.
 *
 * **`sourceConnectionId` participates in the lookup since #2320 and still does
 * NOT belong here.** The two facts are separate: it narrows WHICH row a scoped
 * lookup matches, but it remains master-OWNED and therefore writable, because a
 * pre-existing unattributed row has to be able to acquire provenance in place.
 * Moving it into this group would take it out of the UPDATE set, and #2314's
 * "stamps provenance onto an existing NULL row in place" spec would fail — the
 * row would never be claimed at all. Membership here means "never written",
 * not "used when matching".
 */
export const INVENTORY_IDENTITY_COLUMNS = [
  'id',
  'productId',
  'productVariantId',
  'locationId',
] as const;

/**
 * Columns the master sync owns and may write on an existing row (#2071).
 *
 * - `availableQuantity` — the master's stock figure.
 * - `reservedQuantity` — a **mirror of the master's value, rewritten on every
 *   sync**, NOT an OL-owned counter. This has been misread before; nothing in OL
 *   accumulates into it.
 * - `isStale` — written `false` on every upsert (the sole domain-entity
 *   construction outside this file omits the argument, so the constructor
 *   default applies). That is safe only because `MasterInventorySyncService`
 *   runs its `setInventory` loop BEFORE `pruneStaleVariants`, and the prune
 *   stales exactly the variants the loop did not report — so the two sets are
 *   disjoint and an upsert cannot un-stale a row the same run just flagged.
 *   **Precondition:** any new `upsert` caller must preserve that ordering, or
 *   `isStale` has to leave this set.
 * - `sourceConnectionId` — connection provenance (ADR-058 ladder step (i),
 *   #2314), written by whichever sync creates or refreshes the row. It is in
 *   the UPDATE set deliberately, so a pre-existing row acquires provenance on
 *   its next sync rather than waiting for the #2317 backfill. The consequence
 *   is accepted and known: where two `InventoryMaster` connections claim the
 *   same internal product id, each sync rewrites the other's value and the
 *   column flaps. That is exactly the condition the #1904 rival-claimant guard
 *   already detects (and withholds the prune for), so the guard stays until
 *   ladder step (iii) makes the column authoritative; #2320 inherits the
 *   flapping as a known state.
 */
export const INVENTORY_MASTER_OWNED_COLUMNS = [
  'availableQuantity',
  'reservedQuantity',
  'isStale',
  'sourceConnectionId',
] as const;

/**
 * Columns the database stamps, which the master sync must NOT write (#2071).
 *
 * `updatedAt` is an `@UpdateDateColumn`. TypeORM appends its auto-timestamp only
 * when the column is absent from the SET clause, so naming it would suppress the
 * stamp and persist whatever the master reported. `InventorySyncService` builds
 * the propagation job's dedupe key from this value, so it must remain OL-write
 * time — a master reporting a stable timestamp while quantity moved would
 * collide the key and the propagation would be silently dropped.
 */
export const INVENTORY_DB_MANAGED_COLUMNS = ['updatedAt'] as const;

/**
 * Columns OpenLinker itself owns, which the master sync must NOT write (#2314).
 *
 * **Empty by decomposition, not by oversight.** ADR-058 decision 4 names
 * exactly one such column — `olReservedQuantity`, OL's own reservation counter
 * — and that lands with ADR-061 in Wave 2. The group is declared now so the
 * fourth ownership answer exists before there is a column needing it: the
 * classification spec already forces every new column into exactly one group,
 * and without this group the only available answer for an OL-owned column would
 * be the master-owned set, which is the one place it must never go.
 *
 * Note the neighbouring trap this group exists to keep separate:
 * `reservedQuantity` reads like an OL counter and is not — it is a mirror of
 * the master's value, rewritten every sync.
 *
 * The type annotation is explicit because `[] as const` infers `readonly []`,
 * whose element type is `never` — a spread of that into the classification
 * union would type-check today and silently reject the Wave-2 append.
 */
export const INVENTORY_OL_OWNED_COLUMNS: readonly (keyof InventoryItemOrmEntity)[] = [];

@Injectable()
export class InventoryRepository implements InventoryRepositoryPort {
  private readonly logger = new Logger(InventoryRepository.name);

  constructor(
    @InjectRepository(InventoryItemOrmEntity)
    private readonly repository: Repository<InventoryItemOrmEntity>
  ) {}

  /**
   * See {@link InventoryRepositoryPort.findByProductAndVariant} for the
   * null/undefined asymmetry between the identity columns and the provenance
   * axis — it is the one thing about this method a caller can get wrong.
   */
  async findByProductAndVariant(
    productId: string,
    productVariantId?: string | null,
    locationId?: string | null,
    sourceConnectionId?: string | null
  ): Promise<InventoryItem | null> {
    const resolvedVariantId =
      productVariantId !== undefined && productVariantId !== null ? productVariantId : null;
    const resolvedLocationId =
      locationId !== undefined && locationId !== null ? locationId : null;

    // No provenance axis: keep the exact pre-#2320 `findOne` path rather than
    // routing every axis-less caller through the query builder. Same query,
    // same plan, nothing to re-verify — the scoped branch is the new behaviour
    // and is the only thing that should have to be argued about.
    if (sourceConnectionId === undefined || sourceConnectionId === null) {
      // `Record<string, unknown>` as before: TypeORM's `FindOptionsWhere` does
      // not admit a literal `null`, and matching `IS NULL` is precisely what
      // this method has always needed to do for a product-level or
      // location-less row.
      const where: Record<string, unknown> = {
        productId,
        productVariantId: resolvedVariantId,
        locationId: resolvedLocationId,
      };
      const entity = await this.repository.findOne({ where });
      return entity ? this.toDomain(entity) : null;
    }

    // Scoped: the row is this connection's own, or is unattributed and
    // therefore claimable (NULL and the 'legacy' sentinel are one class).
    const qb = this.repository
      .createQueryBuilder('inv')
      .where('inv.productId = :productId', { productId })
      .andWhere(
        resolvedVariantId === null
          ? 'inv.productVariantId IS NULL'
          : 'inv.productVariantId = :productVariantId',
        resolvedVariantId === null ? {} : { productVariantId: resolvedVariantId }
      )
      .andWhere(
        resolvedLocationId === null ? 'inv.locationId IS NULL' : 'inv.locationId = :locationId',
        resolvedLocationId === null ? {} : { locationId: resolvedLocationId }
      );

    this.applyProvenanceScope(
      qb,
      {
        sourceConnectionId,
        includeUnattributedProvenance: true,
      },
      'inv."sourceConnectionId"'
    );

    // Deterministic by construction: a scoped match can legitimately hit both
    // this connection's own row and an unattributed one, and picking
    // arbitrarily between them would make repeated syncs alternate between two
    // positions. Own provenance wins; `id` breaks the remaining tie so the
    // choice is stable across runs (an `updatedAt` tiebreak would not be — two
    // rows written in the same statement share a timestamp).
    const entity = await qb
      .orderBy('CASE WHEN inv."sourceConnectionId" = :ownConnectionId THEN 0 ELSE 1 END', 'ASC')
      .setParameter('ownConnectionId', sourceConnectionId)
      .addOrderBy('inv.id', 'ASC')
      .getOne();

    return entity ? this.toDomain(entity) : null;
  }

  /**
   * The provenance predicate shared by the scoped lookup and the scoped prune
   * (#2320). #2322 consumes the same {@link ProvenanceScope} shape, so this is
   * the single place the claim rule is expressed.
   *
   * **Always wrapped in `Brackets`.** The prune composes it with the
   * variant-keep predicate, which is itself an OR-group: an unbracketed
   * `a OR b` appended beside `c OR d` re-associates into
   * `... AND c OR d OR a OR b` and would stale rows belonging to another
   * connection entirely. That is a real bug, not a style preference.
   *
   * A `null` scope contributes nothing at all, which is what keeps every
   * pre-#2320 caller byte-identical.
   *
   * `column` is passed rather than assumed because the two call sites build
   * different statements: the SELECT is aliased (`inv."sourceConnectionId"`)
   * while TypeORM's UPDATE builder takes bare quoted column names.
   */
  private applyProvenanceScope(
    qb: { andWhere(condition: Brackets): unknown },
    scope: ProvenanceScope | undefined,
    column: string
  ): void {
    if (!scope) return;

    qb.andWhere(
      new Brackets((inner) => {
        inner.where(`${column} = :scopeConnectionId`, {
          scopeConnectionId: scope.sourceConnectionId,
        });
        if (scope.includeUnattributedProvenance) {
          // NULL and 'legacy' are ONE class ("unattributed"), which is what
          // makes the #2317 backfill's progress irrelevant to correctness here:
          // a row mid-sweep matches identically either side of being stamped.
          inner.orWhere(`${column} IS NULL`);
          inner.orWhere(`${column} = :legacyProvenance`, {
            legacyProvenance: LEGACY_SOURCE_CONNECTION_ID,
          });
        }
      })
    );
  }

  async findMany(
    filters: InventoryFilters,
    pagination: InventoryPagination
  ): Promise<PaginatedInventoryItems> {
    const where: Record<string, unknown> = {};

    if (filters.productId) {
      where.productId = filters.productId;
    }
    if (filters.productVariantId) {
      where.productVariantId = filters.productVariantId;
    }
    if (filters.locationId) {
      where.locationId = filters.locationId;
    }
    // Strict equality, never the write path's claim rule (#2320): a read must
    // not report another connection's unattributed rows as this one's.
    if (filters.sourceConnectionId) {
      where.sourceConnectionId = filters.sourceConnectionId;
    }

    const [entities, total] = await this.repository.findAndCount({
      where,
      order: { updatedAt: 'DESC' },
      take: pagination.limit,
      skip: pagination.offset,
    });

    return {
      items: entities.map((e) => this.toDomain(e)),
      total,
    };
  }

  async findAvailabilityByVariantIds(
    variantIds: readonly string[]
  ): Promise<readonly VariantAvailability[]> {
    if (variantIds.length === 0) return [];

    const rows = await this.repository
      .createQueryBuilder('inv')
      .select('inv.productVariantId', 'productVariantId')
      .addSelect('COALESCE(SUM(inv.availableQuantity), 0)', 'totalAvailable')
      .addSelect('COUNT(DISTINCT inv.locationId)', 'locationCount')
      .addSelect('MAX(inv.updatedAt)', 'stockUpdatedAt')
      .where('inv.productVariantId IN (:...variantIds)', { variantIds: [...variantIds] })
      // Exclude soft-deleted rows so offer flows never act on dead stock (#1478).
      .andWhere('inv.isStale = false')
      .groupBy('inv.productVariantId')
      .getRawMany<{
        productVariantId: string;
        totalAvailable: string;
        locationCount: string;
        stockUpdatedAt: Date | string;
      }>();

    // Postgres returns SUM as numeric (string) and COUNT(DISTINCT) as bigint
    // (string) through TypeORM's raw-query path — explicit Number() cast
    // surfaces the right shape to consumers. MAX(timestamptz) comes back as a
    // Date via the pg driver but is defensively normalised in case the driver
    // hands back a string (the findStockAggregatesByProductIds precedent).
    return rows.map((row) => ({
      productVariantId: row.productVariantId,
      totalAvailable: Number(row.totalAvailable),
      locationCount: Number(row.locationCount),
      stockUpdatedAt:
        row.stockUpdatedAt instanceof Date ? row.stockUpdatedAt : new Date(row.stockUpdatedAt),
    }));
  }

  async findStockAggregatesByProductIds(
    productIds: readonly string[]
  ): Promise<readonly ProductStockAggregate[]> {
    if (productIds.length === 0) return [];

    const rows = await this.repository
      .createQueryBuilder('inv')
      .select('inv.productId', 'productId')
      .addSelect('COALESCE(SUM(inv.availableQuantity), 0)', 'totalAvailable')
      .addSelect('COALESCE(SUM(inv.reservedQuantity), 0)', 'totalReserved')
      .addSelect('MAX(inv.updatedAt)', 'stockUpdatedAt')
      .where('inv.productId IN (:...productIds)', { productIds: [...productIds] })
      // Exclude soft-deleted rows so aggregates never count dead stock (#1478),
      // mirroring findAvailabilityByVariantIds.
      .andWhere('inv.isStale = false')
      .groupBy('inv.productId')
      .getRawMany<{
        productId: string;
        totalAvailable: string;
        totalReserved: string;
        stockUpdatedAt: Date | string;
      }>();

    // SUM comes back as numeric (string) through TypeORM's raw-query path;
    // MAX(timestamptz) comes back as a Date via the pg driver but is defensively
    // normalised in case the driver hands back a string.
    return rows.map((row) => ({
      productId: row.productId,
      totalAvailable: Number(row.totalAvailable),
      totalReserved: Number(row.totalReserved),
      stockUpdatedAt: row.stockUpdatedAt instanceof Date ? row.stockUpdatedAt : new Date(row.stockUpdatedAt),
    }));
  }

  async markStaleExceptVariants(
    productId: string,
    keepVariantIds: readonly (string | null)[],
    scope?: ProvenanceScope
  ): Promise<PruneStaleVariantsResult> {
    const nonNullKeep = keepVariantIds.filter((v): v is string => v !== null);
    const keepNull = keepVariantIds.includes(null);

    const qb = this.repository
      .createQueryBuilder()
      .update(InventoryItemOrmEntity)
      .set({ isStale: true })
      .where('productId = :productId', { productId })
      .andWhere('isStale = false')
      .andWhere(
        // A row is stale iff its variant is not in the keep set. Each branch
        // guards its own NULL so the predicate is total (never three-valued),
        // and NOT IN is only applied to guaranteed-non-null values.
        new Brackets((qb) => {
          if (nonNullKeep.length > 0) {
            qb.where(
              'productVariantId IS NOT NULL AND productVariantId NOT IN (:...keep)',
              { keep: nonNullKeep }
            );
          } else {
            qb.where('productVariantId IS NOT NULL');
          }
          if (!keepNull) {
            qb.orWhere('productVariantId IS NULL');
          }
        })
      );

    // Provenance restriction, if any (#2320) — bracketed, and appended AFTER
    // the variant-keep group so the two OR-groups stay independent.
    this.applyProvenanceScope(qb, scope, '"sourceConnectionId"');

    const result = await qb.returning(['productVariantId']).execute();

    // RETURNING yields one raw row per flagged inventory row; distinct non-null
    // variant ids feed the master-deletion event payload (#1599). Product-level
    // rows carry a NULL variant id and are counted but not surfaced as ids.
    const raw = result.raw as { productVariantId: string | null }[];
    const variantIds = [
      ...new Set(raw.map((r) => r.productVariantId).filter((v): v is string => v !== null)),
    ];
    return { markedCount: result.affected ?? raw.length, variantIds };
  }

  /**
   * Second `isStale` writer on this table (#2322, ADR-058 decision (2)) —
   * see the port docblock for what the rule is and why it is a repair.
   *
   * Two preconditions the SQL itself cannot state. It is called AFTER the
   * `setInventory` loop, so the located rows it is reacting to are already
   * committed and a contradiction inside one payload resolves deterministically
   * (located wins). And it is called only where the caller has established sole
   * claim, which is what makes `includeUnattributedProvenance` safe.
   *
   * The empty-set early return is behavioural, not an optimisation: with no
   * located variants there is nothing to enforce, and a round-trip that could
   * only ever match zero rows should not touch storage at all.
   */
  async markLocationlessStaleForSource(
    productId: string,
    locatedVariantKeys: readonly (string | null)[],
    scope: ProvenanceScope
  ): Promise<PruneStaleVariantsResult> {
    if (locatedVariantKeys.length === 0) {
      return { markedCount: 0, variantIds: [] };
    }

    const nonNullLocated = locatedVariantKeys.filter((v): v is string => v !== null);
    const locatedNull = locatedVariantKeys.includes(null);

    const qb = this.repository
      .createQueryBuilder()
      .update(InventoryItemOrmEntity)
      .set({ isStale: true })
      .where('productId = :productId', { productId })
      .andWhere('isStale = false')
      // The pooled half of the rule: only a row that declines to locate is an
      // orphan of a located write. A row AT a location is the located write.
      .andWhere('"locationId" IS NULL')
      .andWhere(
        // A row is an orphan iff its variant is one the master just located.
        // Each branch guards its own NULL so the predicate stays total, and IN
        // is only applied to guaranteed-non-null values — the same discipline
        // `markStaleExceptVariants` keeps, in the mirror-image direction.
        new Brackets((inner) => {
          if (nonNullLocated.length > 0) {
            inner.where('productVariantId IN (:...located)', { located: nonNullLocated });
          }
          if (locatedNull) {
            if (nonNullLocated.length > 0) {
              inner.orWhere('productVariantId IS NULL');
            } else {
              inner.where('productVariantId IS NULL');
            }
          }
        })
      );

    // Per-source restriction (#2320), bracketed and appended AFTER the variant
    // group so the two OR-groups stay independent. REQUIRED here: an unscoped
    // sweep would stale a rival master's pooled row over this master's choice.
    this.applyProvenanceScope(qb, scope, '"sourceConnectionId"');

    // No `updatedAt` in the SET: the stock facts did not change, only their
    // liveness, and moving the timestamp would misreport when stock was last
    // observed (the #2321 `stockUpdatedAt` read).
    const result = await qb.returning(['productVariantId']).execute();

    const raw = result.raw as { productVariantId: string | null }[];
    const variantIds = [
      ...new Set(raw.map((r) => r.productVariantId).filter((v): v is string => v !== null)),
    ];
    return { markedCount: result.affected ?? raw.length, variantIds };
  }


  /**
   * Read-only duplicate-position scan (#2319, ADR-058 ladder step (iii)).
   *
   * ## Why this is raw SQL — a first for this repository
   *
   * Two things the query builder cannot express drive the departure, and both
   * are load-bearing rather than stylistic:
   *
   * 1. **`IS NOT DISTINCT FROM`.** The detail query has to join the capped set
   *    of duplicate keys back to the rows carrying them, and three of the four
   *    key columns are nullable. A naive `=` join drops every group whose
   *    variant, location or provenance is NULL — which is most of them on a
   *    pre-#2317 install, i.e. it would report a clean table while the very
   *    rows #2325 will trip over sit there unlisted.
   * 2. **A CTE with `LIMIT` feeding a self-join.** The cap has to be applied to
   *    the GROUPS, not to the rows, or a single large group would consume the
   *    whole budget and hide every other one.
   *
   * ## Two statements on purpose
   *
   * The totals are computed by their own uncapped statement. `groupCount` is
   * the #2325 readiness gate, so it must count the whole table; deriving it
   * from the capped detail would silently report "clean" the moment detail
   * truncates. Precedent for `repository.query` in `libs/core`:
   * `order-record.repository.ts` and `user.repository.ts`.
   *
   * ## Deliberate non-optimisations
   *
   * Both statements are full scans of `inventory_items` and there is no index
   * that helps a four-column grouping including two nullable columns. That is
   * accepted: this is an operator-run diagnostic, not a hot path. Do **not**
   * "optimise" it onto either partial unique index — those indexes are
   * NULL-distinct, which is precisely the semantics that admitted these rows,
   * so an index-backed scan would fail to see what it is looking for.
   *
   * There is **no `WHERE` clause restricting rows** in either statement: stale
   * rows are included, because a stale duplicate still collides under the index
   * #2325 creates. `liveRowCount` reports the live subset instead. A unit test
   * asserts the absence of that predicate so a later refactor cannot blind the
   * gate.
   *
   * The table name is the literal `inventory_items` (matching the `@Entity`
   * decorator); `maxGroups` is a bound parameter, never interpolated.
   */
  async findDuplicatePositions(maxGroups: number): Promise<DuplicatePositionReport> {
    const [totals] = (await this.repository.query(
      `SELECT COUNT(*)::int AS "groupCount",
              COALESCE(SUM(dup.row_count), 0)::int AS "rowCount"
         FROM (
           SELECT COUNT(*) AS row_count
             FROM "inventory_items"
            GROUP BY "productId", "productVariantId", "locationId", "sourceConnectionId"
           HAVING COUNT(*) > 1
         ) dup`
    )) as { groupCount: number | string; rowCount: number | string }[];

    // `::int` already narrows these, but the pg driver's typing for a raw query
    // is `any`, and COUNT/SUM have come back as strings on other paths in this
    // file — normalise rather than trust.
    const groupCount = Number(totals?.groupCount ?? 0);
    const rowCount = Number(totals?.rowCount ?? 0);

    if (groupCount === 0) {
      return { groupCount: 0, rowCount: 0, excessRowCount: 0, groups: [], truncated: false };
    }

    const rows = (await this.repository.query(
      `WITH dup_keys AS (
         SELECT "productId",
                "productVariantId",
                "locationId",
                "sourceConnectionId",
                COUNT(*) AS row_count,
                COUNT(*) FILTER (WHERE NOT "isStale") AS live_row_count
           FROM "inventory_items"
          GROUP BY "productId", "productVariantId", "locationId", "sourceConnectionId"
         HAVING COUNT(*) > 1
          ORDER BY row_count DESC,
                   "productId" ASC,
                   "productVariantId" ASC NULLS FIRST,
                   "locationId" ASC NULLS FIRST,
                   "sourceConnectionId" ASC NULLS FIRST
          LIMIT $1
       )
       SELECT k."productId"           AS "productId",
              k."productVariantId"    AS "productVariantId",
              k."locationId"          AS "locationId",
              k."sourceConnectionId"  AS "sourceConnectionId",
              k.row_count::int        AS "rowCount",
              k.live_row_count::int   AS "liveRowCount",
              i."id"                  AS "id",
              i."availableQuantity"   AS "availableQuantity",
              i."reservedQuantity"    AS "reservedQuantity",
              i."isStale"             AS "isStale",
              i."updatedAt"           AS "updatedAt"
         FROM dup_keys k
         JOIN "inventory_items" i
           ON i."productId" = k."productId"
          -- IS NOT DISTINCT FROM, not =: NULL variant / location / provenance
          -- must match its NULL counterpart or the group vanishes from the report.
          AND i."productVariantId"   IS NOT DISTINCT FROM k."productVariantId"
          AND i."locationId"         IS NOT DISTINCT FROM k."locationId"
          AND i."sourceConnectionId" IS NOT DISTINCT FROM k."sourceConnectionId"
        ORDER BY k.row_count DESC,
                 k."productId" ASC,
                 k."productVariantId" ASC NULLS FIRST,
                 k."locationId" ASC NULLS FIRST,
                 k."sourceConnectionId" ASC NULLS FIRST,
                 -- Newest first inside a group: the documented survivor rule
                 -- picks the most recently written live row.
                 i."updatedAt" DESC,
                 i."id" ASC`,
      [maxGroups]
    )) as {
      productId: string;
      productVariantId: string | null;
      locationId: string | null;
      sourceConnectionId: string | null;
      rowCount: number | string;
      liveRowCount: number | string;
      id: string;
      availableQuantity: number | string;
      reservedQuantity: number | string;
      isStale: boolean;
      updatedAt: Date | string;
    }[];

    // The ORDER BY keeps a group's rows contiguous, so folding is a single pass
    // keyed on the four columns (JSON-encoded so a NULL cannot collide with the
    // literal string 'null').
    const groups: DuplicatePositionGroup[] = [];
    const byKey = new Map<string, DuplicatePositionGroup>();
    for (const row of rows) {
      const key = JSON.stringify([
        row.productId,
        row.productVariantId,
        row.locationId,
        row.sourceConnectionId,
      ]);
      let group = byKey.get(key);
      if (!group) {
        group = {
          productId: row.productId,
          productVariantId: row.productVariantId,
          locationId: row.locationId,
          sourceConnectionId: row.sourceConnectionId,
          rowCount: Number(row.rowCount),
          liveRowCount: Number(row.liveRowCount),
          rows: [],
        };
        byKey.set(key, group);
        groups.push(group);
      }
      group.rows.push({
        id: row.id,
        availableQuantity: Number(row.availableQuantity),
        reservedQuantity: Number(row.reservedQuantity),
        isStale: row.isStale,
        updatedAt: row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt),
      });
    }

    return {
      groupCount,
      rowCount,
      // Rows that must disappear before the #2325 index can build: one row per
      // group is allowed to survive.
      excessRowCount: rowCount - groupCount,
      groups,
      truncated: groups.length < groupCount,
    };
  }

  async upsert(item: InventoryItem): Promise<InventoryItem> {
    // Try to find existing inventory by unique constraint first
    // The provenance axis is DERIVED from the item, never passed separately
    // (#2320): the item already carries the only value a caller could supply,
    // and a second argument would create a way for the two to disagree. A null
    // here keeps the pre-#2320 unscoped lookup exactly.
    const existing = await this.findByProductAndVariant(
      item.productId,
      item.productVariantId,
      item.locationId,
      item.sourceConnectionId
    );

    if (existing) {
      // Column-scoped on purpose (#2071): the master sync writes exactly
      // INVENTORY_MASTER_OWNED_COLUMNS and nothing else. Previously this was a
      // `save()`, so the write set was an emergent property of TypeORM's diffing
      // — a column added to the entity later would have silently joined it, and
      // this is the row every published quantity derives from.
      //
      // `updatedAt` is deliberately absent from the SET clause: TypeORM appends
      // the `@UpdateDateColumn` timestamp only when the column is not already
      // being written, so naming it here would suppress the auto-stamp and
      // persist the master-supplied value instead. `InventorySyncService` derives
      // the propagation job's dedupe key from this field, so it must stay
      // OL-write time.
      const updated = await this.repository
        .createQueryBuilder()
        .update(InventoryItemOrmEntity)
        // Deliberately a literal rather than something built from
        // INVENTORY_MASTER_OWNED_COLUMNS: the literal is what gives TypeORM's
        // key type-checking something to check. The spec asserts the two agree,
        // so do not "DRY" this into a computed object — that trades a compile-time
        // guarantee for a runtime one.
        .set({
          availableQuantity: item.availableQuantity,
          reservedQuantity: item.reservedQuantity,
          isStale: item.isStale,
          sourceConnectionId: item.sourceConnectionId,
        })
        .where('id = :id', { id: existing.id })
        .returning(['updatedAt'])
        .execute();

      // A scoped UPDATE cannot resurrect a row the way `save()` would have
      // (it fell back to an INSERT). Returning an item for a row that no longer
      // exists would enqueue a marketplace propagation for absent stock, so fail
      // loudly instead. Expected to be unreachable — see InventoryRowVanishedError.
      if (updated.affected === 0) {
        throw new InventoryRowVanishedError(existing.id, item.productId, item.productVariantId);
      }

      // RETURNING carries the DB-stamped `updatedAt` back in the same round-trip,
      // which the caller cannot reconstruct from `item`. An empty `raw` on an
      // affected row means the driver ignored RETURNING (TypeORM makes it a
      // silent no-op where unsupported). Why that is an error rather than a
      // fallback, and why the value is validated rather than just the row, is in
      // `resolvePersistedUpdatedAt`.
      const [returnedRow] = updated.raw as { updatedAt?: Date | string }[];
      const persistedUpdatedAt = this.resolvePersistedUpdatedAt(returnedRow?.updatedAt, existing.id);

      return new InventoryItem(
        existing.id,
        existing.productId,
        existing.productVariantId,
        item.availableQuantity,
        item.reservedQuantity,
        existing.locationId,
        persistedUpdatedAt,
        item.isStale,
        item.sourceConnectionId
      );
    } else {
      // Insert new inventory item.
      //
      // Deliberately NOT column-scoped, unlike the update branch above: an INSERT
      // necessarily writes every column, so there is no other writer's column to
      // avoid clobbering. `toOrmEntity` is now an insert-only mapping.
      //
      // If the provided ID is not a valid UUID or doesn't exist, let TypeORM generate it
      // This handles the case where adapter's identifier mapping ID is used
      //
      // Newly reachable since #2320: with the lookup scoped, a second source no
      // longer matches (and clobbers) the first source's row, so it arrives
      // here intending its own. At a NULL `locationId` the partial unique
      // indexes are NULL-distinct and both rows are admitted — cross-source
      // coexistence, per ADR-058 decision (2). At a NON-NULL `locationId` there
      // is no NULL to be distinct about and the insert is refused; that is a
      // permanent condition, so it is translated rather than left to burn a
      // retry ladder. See InventoryCrossSourcePositionConflictError.
      const entity = this.toOrmEntity(item);
      try {
        return await this.insertNewRow(entity, item);
      } catch (error) {
        if (this.isPositionUniqueViolation(error)) {
          this.logger.error(
            `inventory_cross_source_position_conflict product=${item.productId} ` +
              `variant=${item.productVariantId ?? 'base'} location=${item.locationId ?? 'default'} ` +
              `source=${item.sourceConnectionId ?? 'unattributed'}`
          );
          throw new InventoryCrossSourcePositionConflictError(
            item.productId,
            item.productVariantId,
            item.locationId,
            item.sourceConnectionId
          );
        }
        throw error;
      }
    }
  }

  /** The insert half of {@link upsert}, extracted so its one failure mode can be caught. */
  private async insertNewRow(
    entity: InventoryItemOrmEntity,
    item: InventoryItem
  ): Promise<InventoryItem> {
    if (!this.isValidUUID(item.id)) {
      // Clear ID - create new entity without ID property
      // TypeORM will require an ID, so we'll use a new UUID
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- strip caller-provided id via destructure so TypeORM regenerates a fresh UUID below
      const { id: _unused, ...entityWithoutId } = entity;
      const newEntity = this.repository.create({
        ...entityWithoutId,
        id: randomUUID(),
      });
      const saved = await this.repository.save(newEntity);
      return this.toDomainWithStampedUpdatedAt(saved);
    }
    const saved = await this.repository.save(entity);
    return this.toDomainWithStampedUpdatedAt(saved);
  }

  /**
   * Recognise a rejection from either partial unique index on `inventory_items`
   * (#2320).
   *
   * Message-regex rather than `code === '23505'`, matching this context's own
   * `LocationRepository.isUniqueCodeViolation` idiom: naming the indexes keeps
   * the check specific to the POSITION key, so an unrelated future constraint
   * on this table cannot be silently reported as a cross-source conflict.
   */
  private isPositionUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      /duplicate key|IDX_inventory_items_product_(variant|base)_unique/i.test(error.message)
    );
  }

  /**
   * Check if a string is a valid UUID
   */
  private isValidUUID(id: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(id);
  }

  /**
   * Resolve the DB-stamped `updatedAt` both upsert branches depend on (#2071).
   *
   * `updatedAt` is excluded from the update's SET clause and from `toOrmEntity`,
   * so on BOTH paths the value can only come back from the database. Neither
   * path can fall back to `item.updatedAt`: that is the master's timestamp, and
   * persisting it is the exact defect this exclusion exists to prevent — a
   * master reporting a stable timestamp while quantity moved would collide
   * `InventorySyncService`'s propagation dedupe key and the propagation would be
   * silently dropped.
   *
   * Two ways the value can arrive unusable, both treated as the same fault
   * (the driver did not give us a stamp we can trust):
   *  - absent — the driver ignored RETURNING, or `save()` returned no row;
   *  - present but unparseable — `new Date(...)` yields `Invalid Date`. Today
   *    the raw key is literally `"updatedAt"` only because no `namingStrategy`
   *    is configured; adopt a snake_case strategy and the property would read
   *    `undefined` while the row object stayed truthy, so guard the value
   *    rather than the row.
   */
  private resolvePersistedUpdatedAt(raw: Date | string | undefined | null, rowId: string): Date {
    if (raw === undefined || raw === null) {
      throw new InventoryReturningUnsupportedError(rowId);
    }
    const resolved = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(resolved.getTime())) {
      throw new InventoryReturningUnsupportedError(rowId);
    }
    return resolved;
  }

  /**
   * One bounded page of the `'legacy'` provenance backfill (#2317, ADR-058
   * ladder step (ii)).
   *
   * ## Why raw SQL is mandatory here, not merely preferred
   *
   * `updatedAt` is an `@UpdateDateColumn`, and the docblocks above
   * ({@link INVENTORY_DB_MANAGED_COLUMNS}, and the upsert's update branch)
   * record the behaviour that decides this: TypeORM APPENDS its auto-timestamp
   * to any `.update().set()` whose SET clause does not already name the column.
   * That is exactly right for the master-sync upsert — a real stock write
   * SHOULD move `updatedAt` — and exactly wrong here. This pass changes no
   * stock, yet a query-builder update would bump `updatedAt` on every row it
   * touched, and `InventorySyncService` builds the propagation job's dedupe key
   * from that value. A table-wide bump would either replay a propagation for
   * every SKU on every marketplace, or collide the keys and drop them silently.
   * Neither is acceptable from a backfill whose entire job is to be invisible.
   *
   * A raw statement writes precisely the columns it names. Precedent:
   * `order-record.repository.ts` `markCancelled`, raw for the same reason — and
   * its sibling `updateSalesDocumentBlock`, which names `"updatedAt" = now()`
   * explicitly where it DOES want the bump. The two together are the proof that
   * this is a deliberate choice in both directions rather than an idiom.
   *
   * ## The sub-select, clause by clause
   *
   * - `WHERE "sourceConnectionId" IS NULL` appears in BOTH the sub-select and
   *   the outer UPDATE. The inner one selects the page; the outer one re-checks
   *   under the row lock, so a row a live sync claimed in between is not
   *   stamped back down to the sentinel. The sentinel may only ever lose to a
   *   real connection id, never overwrite one.
   * - `ORDER BY "id"` makes a page deterministic, which is what lets the e2e
   *   spec assert a drain sequence rather than only a total.
   * - `FOR UPDATE SKIP LOCKED`, never a plain `FOR UPDATE`: a row mid-write by
   *   `setInventory` is skipped and collected next tick. Waiting on it would put
   *   a backfill in the blocking path of a buyer-facing stock write.
   * - It is a sub-select because Postgres has no `LIMIT` on `UPDATE`. Never
   *   rewrite this as a predicate-less `COALESCE` over the table: that locks
   *   every row in one statement, which is the hazard the whole bounded-pass
   *   design exists to avoid.
   *
   * The sentinel is the shared {@link LEGACY_SOURCE_CONNECTION_ID} and `limit`
   * is bound too — nothing is interpolated into the statement.
   */
  async backfillLegacyProvenance(limit: number): Promise<number> {
    const result = (await this.repository.query(
      `UPDATE "inventory_items"
          SET "sourceConnectionId" = $1
        WHERE "id" IN (
                SELECT "id"
                  FROM "inventory_items"
                 WHERE "sourceConnectionId" IS NULL
                 ORDER BY "id"
                 LIMIT $2
                 FOR UPDATE SKIP LOCKED
              )
          AND "sourceConnectionId" IS NULL`,
      [LEGACY_SOURCE_CONNECTION_ID, limit]
    )) as [unknown[], number] | undefined;

    // node-postgres surfaces a non-RETURNING UPDATE as `[rows, affectedCount]`
    // through TypeORM's raw query. Normalised rather than trusted: the driver's
    // typing for a raw query is `any`.
    return Number(result?.[1] ?? 0);
  }

  /**
   * Uncapped, unfiltered count of rows still missing provenance (#2317).
   *
   * Unfiltered on purpose — including stale rows, which #2325's `SET NOT NULL`
   * will trip over exactly as readily as live ones.
   */
  async countMissingProvenance(): Promise<number> {
    const [row] = (await this.repository.query(
      `SELECT COUNT(*)::int AS "remaining"
         FROM "inventory_items"
        WHERE "sourceConnectionId" IS NULL`
    )) as { remaining: number | string }[];

    return Number(row?.remaining ?? 0);
  }

  /**
   * `toDomain` for the insert branch, asserting the DB stamped `updatedAt`.
   *
   * The update branch fails loudly when the stamp is missing; without this the
   * insert branch would hand back an `InventoryItem` whose `updatedAt` is typed
   * `Date` but is actually `undefined`, into the same dedupe-key consumer.
   */
  private toDomainWithStampedUpdatedAt(entity: InventoryItemOrmEntity): InventoryItem {
    entity.updatedAt = this.resolvePersistedUpdatedAt(entity.updatedAt, entity.id);
    return this.toDomain(entity);
  }

  /**
   * Map ORM entity to domain entity
   */
  private toDomain(entity: InventoryItemOrmEntity): InventoryItem {
    return new InventoryItem(
      entity.id,
      entity.productId,
      entity.productVariantId,
      entity.availableQuantity,
      entity.reservedQuantity,
      entity.locationId,
      entity.updatedAt,
      entity.isStale,
      entity.sourceConnectionId
    );
  }

  /**
   * Map domain entity to ORM entity
   */
  private toOrmEntity(item: InventoryItem): InventoryItemOrmEntity {
    const entity = new InventoryItemOrmEntity();
    entity.id = item.id;
    entity.productId = item.productId;
    entity.productVariantId = item.productVariantId;
    entity.availableQuantity = item.availableQuantity;
    entity.reservedQuantity = item.reservedQuantity;
    entity.locationId = item.locationId;
    // A freshly-synced/upserted row is always live — this is what clears a
    // previously-stale flag when a deleted variant reappears at the master (#1478).
    entity.isStale = item.isStale;
    // Connection provenance (#2314). `null` here is legal and means "unknown" —
    // an insert from a caller that carries no connection axis, which the #2317
    // sweep later stamps with the `'legacy'` sentinel.
    entity.sourceConnectionId = item.sourceConnectionId;
    // `updatedAt` is deliberately NOT assigned (#2071). Assigning an
    // @UpdateDateColumn puts it in the change map and suppresses
    // CURRENT_TIMESTAMP, which would persist the master's timestamp on INSERT
    // exactly as it used to on UPDATE — and the propagation dedupe key reads
    // this column. Leaving it unset lets TypeORM/Postgres stamp it.
    return entity;
  }
}
