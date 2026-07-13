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
import type {
  InventoryFilters,
  InventoryPagination,
  PaginatedInventoryItems,
  VariantAvailability,
} from '../../../domain/types/inventory.types';

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

  async findById(id: string): Promise<InventoryItem | null> {
    const entity = await this.repository.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
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

  async markStaleExceptVariants(
    productId: string,
    keepVariantIds: readonly (string | null)[]
  ): Promise<number> {
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
      .execute();

    return result.affected ?? 0;
  }

  async upsert(item: InventoryItem): Promise<InventoryItem> {
    // Try to find existing inventory by unique constraint first
    const existing = await this.findByProductAndVariant(
      item.productId,
      item.productVariantId,
      item.locationId
    );

    const entity = this.toOrmEntity(item);

    if (existing) {
      // Update existing inventory item
      entity.id = existing.id;
      const saved = await this.repository.save(entity);
      return this.toDomain(saved);
    } else {
      // Insert new inventory item
      // If the provided ID is not a valid UUID or doesn't exist, let TypeORM generate it
      // This handles the case where adapter's identifier mapping ID is used
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
        return this.toDomain(saved);
      }
      const saved = await this.repository.save(entity);
      return this.toDomain(saved);
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
      entity.isStale
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
    entity.updatedAt = item.updatedAt;
    return entity;
  }
}
