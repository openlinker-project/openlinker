/**
 * Product Variant Repository
 *
 * Repository implementation for product variant persistence operations.
 * Provides data access methods for finding and upserting variants,
 * with conversion between domain entities and ORM entities.
 *
 * Implements ProductVariantRepositoryPort to maintain proper dependency
 * direction and enable easy testing/mocking.
 *
 * @module libs/core/src/products/infrastructure/persistence/repositories
 * @implements {ProductVariantRepositoryPort}
 * @see {@link ProductVariantOrmEntity} for the database entity
 * @see {@link ProductVariantRepositoryPort} for the port interface
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ProductVariantOrmEntity } from '../entities/product-variant.orm-entity';
import { ProductVariantRepositoryPort } from '../../../domain/ports/product-variant-repository.port';
import { ProductVariant } from '../../../domain/entities/product-variant.entity';

@Injectable()
export class ProductVariantRepository implements ProductVariantRepositoryPort {
  constructor(
    @InjectRepository(ProductVariantOrmEntity)
    private readonly repository: Repository<ProductVariantOrmEntity>,
  ) {}

  async findById(id: string): Promise<ProductVariant | null> {
    const entity = await this.repository.findOne({
      where: { id },
    });

    if (!entity) {
      return null;
    }

    return this.toDomain(entity);
  }

  async findByProductId(productId: string): Promise<ProductVariant[]> {
    const entities = await this.repository.find({
      where: { productId },
    });

    return entities.map((entity) => this.toDomain(entity));
  }

  async findBySku(sku: string): Promise<ProductVariant | null> {
    const entity = await this.repository.findOne({
      where: { sku },
    });

    if (!entity) {
      return null;
    }

    return this.toDomain(entity);
  }

  async findBySkuIn(skus: string[]): Promise<ProductVariant[]> {
    if (skus.length === 0) {
      return [];
    }

    const entities = await this.repository.find({
      where: { sku: In(skus) },
    });

    return entities.map((entity) => this.toDomain(entity));
  }

  async findByEanOrGtinIn(values: string[]): Promise<ProductVariant[]> {
    if (values.length === 0) {
      return [];
    }

    const entities = await this.repository
      .createQueryBuilder('variant')
      .where(`variant.attributes ->> 'ean' IN (:...values)`, { values })
      .orWhere(`variant.attributes ->> 'gtin' IN (:...values)`, { values })
      .getMany();

    return entities.map((entity) => this.toDomain(entity));
  }

  async upsert(variant: ProductVariant): Promise<ProductVariant> {
    const entity = this.toOrmEntity(variant);
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  async upsertMany(variants: ProductVariant[]): Promise<ProductVariant[]> {
    if (variants.length === 0) {
      return [];
    }

    // Validate that all variants have a productId
    const productId = variants[0]?.productId;
    if (!productId) {
      throw new Error('Variant must have a productId');
    }

    // Save variants - let database foreign key constraint handle product existence
    // If product doesn't exist, database will throw FK constraint violation
    // This is more reliable than explicit check (avoids transaction visibility issues)
    const entities = variants.map((variant) => this.toOrmEntity(variant));
    try {
      const saved = await this.repository.save(entities);
      return saved.map((entity) => this.toDomain(entity));
    } catch (error) {
      // Enhance error message for foreign key constraint violations
      if (
        error instanceof Error &&
        (error.message.includes('foreign key') ||
          error.message.includes('FK_') ||
          error.message.includes('violates foreign key constraint'))
      ) {
        throw new Error(
          `Cannot save variants: Product with id ${productId} does not exist. Ensure product is saved before variants.`,
        );
      }
      throw error;
    }
  }

  /**
   * Map ORM entity to domain entity
   */
  private toDomain(entity: ProductVariantOrmEntity): ProductVariant {
    return new ProductVariant(
      entity.id,
      entity.productId,
      entity.sku,
      entity.attributes,
      entity.createdAt,
      entity.updatedAt,
    );
  }

  /**
   * Map domain entity to ORM entity
   */
  private toOrmEntity(variant: ProductVariant): ProductVariantOrmEntity {
    const entity = new ProductVariantOrmEntity();
    entity.id = variant.id;
    entity.productId = variant.productId;
    entity.sku = variant.sku;
    entity.attributes = variant.attributes;
    entity.createdAt = variant.createdAt;
    entity.updatedAt = variant.updatedAt;
    return entity;
  }
}

