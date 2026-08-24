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
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { InventoryItemOrmEntity } from '../entities/inventory-item.orm-entity';
import type { InventoryRepositoryPort } from '../../../domain/ports/inventory-repository.port';
import { InventoryItem } from '../../../domain/entities/inventory-item.entity';
import { InventoryReturningUnsupportedError } from '../../../domain/exceptions/inventory-returning-unsupported.error';
import { InventoryRowVanishedError } from '../../../domain/exceptions/inventory-row-vanished.error';
import type {
  InventoryFilters,
  InventoryPagination,
  PaginatedInventoryItems,
  VariantAvailability,
  ProductStockAggregate,
  PruneStaleVariantsResult,
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
  constructor(
    @InjectRepository(InventoryItemOrmEntity)
    private readonly repository: Repository<InventoryItemOrmEntity>
  ) {}

  async findByProductAndVariant(
    productId: string,
    productVariantId?: string | null,
    locationId?: string | null
  ): Promise<InventoryItem | null> {
    const where: Record<string, unknown> = {
      productId,
    };

    if (productVariantId !== undefined && productVariantId !== null) {
      where.productVariantId = productVariantId;
    } else {
      where.productVariantId = null;
    }

    if (locationId !== undefined && locationId !== null) {
      where.locationId = locationId;
    } else {
      where.locationId = null;
    }

    const entity = await this.repository.findOne({
      where,
    });

    if (!entity) {
      return null;
    }

    return this.toDomain(entity);
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
      .where('inv.productVariantId IN (:...variantIds)', { variantIds: [...variantIds] })
      // Exclude soft-deleted rows so offer flows never act on dead stock (#1478).
      .andWhere('inv.isStale = false')
      .groupBy('inv.productVariantId')
      .getRawMany<{
        productVariantId: string;
        totalAvailable: string;
        locationCount: string;
      }>();

    // Postgres returns SUM as numeric (string) and COUNT(DISTINCT) as bigint
    // (string) through TypeORM's raw-query path — explicit Number() cast
    // surfaces the right shape to consumers.
    return rows.map((row) => ({
      productVariantId: row.productVariantId,
      totalAvailable: Number(row.totalAvailable),
      locationCount: Number(row.locationCount),
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
    keepVariantIds: readonly (string | null)[]
  ): Promise<PruneStaleVariantsResult> {
    const nonNullKeep = keepVariantIds.filter((v): v is string => v !== null);
    const keepNull = keepVariantIds.includes(null);

    const result = await this.repository
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
      )
      .returning(['productVariantId'])
      .execute();

    // RETURNING yields one raw row per flagged inventory row; distinct non-null
    // variant ids feed the master-deletion event payload (#1599). Product-level
    // rows carry a NULL variant id and are counted but not surfaced as ids.
    const raw = result.raw as { productVariantId: string | null }[];
    const variantIds = [
      ...new Set(raw.map((r) => r.productVariantId).filter((v): v is string => v !== null)),
    ];
    return { markedCount: result.affected ?? raw.length, variantIds };
  }

  async upsert(item: InventoryItem): Promise<InventoryItem> {
    // Try to find existing inventory by unique constraint first
    const existing = await this.findByProductAndVariant(
      item.productId,
      item.productVariantId,
      item.locationId
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
      const entity = this.toOrmEntity(item);
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
