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
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { InventoryItemOrmEntity } from '../entities/inventory-item.orm-entity';
import { InventoryRepositoryPort } from '@openlinker/core/inventory/domain/ports/inventory-repository.port';
import { InventoryItem } from '@openlinker/core/inventory/domain/entities/inventory-item.entity';

@Injectable()
export class InventoryRepository implements InventoryRepositoryPort {
  constructor(
    @InjectRepository(InventoryItemOrmEntity)
    private readonly repository: Repository<InventoryItemOrmEntity>,
  ) {}

  async findByProductAndVariant(
    productId: string,
    productVariantId?: string | null,
    locationId?: string | null,
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

  async upsert(item: InventoryItem): Promise<InventoryItem> {
    // Try to find existing inventory by unique constraint first
    const existing = await this.findByProductAndVariant(
      item.productId,
      item.productVariantId,
      item.locationId,
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
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
    entity.updatedAt = item.updatedAt;
    return entity;
  }
}

