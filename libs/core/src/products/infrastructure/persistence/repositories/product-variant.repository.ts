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
import { Repository, In, Brackets } from 'typeorm';
import { ProductVariantOrmEntity } from '../entities/product-variant.orm-entity';
import { ProductVariantRepositoryPort } from '../../../domain/ports/product-variant-repository.port';
import { ProductVariant } from '../../../domain/entities/product-variant.entity';
import { ProductVariantListFilters, ProductPagination, PaginatedProductVariants } from '../../../domain/types/product.types';
import { normalizeBarcode } from '../../../domain/utils/barcode-normalization';

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

  async findByEanOrGtinIn(
    connectionId: string,
    values: string[],
    field: 'ean' | 'gtin',
  ): Promise<ProductVariant[]> {
    const normalizedValues = [
      ...new Set(
        values
          .map((value) => normalizeBarcode(value))
          .filter((value): value is string => !!value),
      ),
    ];
    if (normalizedValues.length === 0) {
      return [];
    }

    const attributeKey = field === 'ean' ? 'ean' : 'gtin';

    const entities = await this.repository
      .createQueryBuilder('variant')
      .innerJoin(
        'identifier_mappings',
        'mapping',
        `
          mapping.internalId = variant.id
          AND mapping.connectionId = :connectionId
          AND mapping.entityType = :entityType
          AND (mapping.context -> 'metadata' ->> 'isVariant') = 'true'
        `,
        {
          connectionId,
          entityType: 'Product',
        },
      )
      .where(
        new Brackets((qb) => {
          qb.where(`variant.${field} IN (:...values)`, { values: normalizedValues }).orWhere(
            `(variant.${field} IS NULL AND variant.attributes ->> '${attributeKey}' IN (:...values))`,
            { values: normalizedValues },
          );
        }),
      )
      .getMany();

    return entities.map((entity) => this.toDomain(entity));
  }

  async findMany(
    filters: ProductVariantListFilters,
    pagination: ProductPagination,
  ): Promise<PaginatedProductVariants> {
    const qb = this.repository.createQueryBuilder('variant');

    if (filters.productId) {
      qb.andWhere('variant.productId = :productId', { productId: filters.productId });
    }

    if (filters.search) {
      const escapedSearch = filters.search.replace(/[%_]/g, '\\$&');
      qb.andWhere(
        '(variant.sku ILIKE :search OR variant.ean ILIKE :search OR variant.gtin ILIKE :search)',
        { search: `%${escapedSearch}%` },
      );
    }

    qb.orderBy('variant.createdAt', 'DESC')
      .skip(pagination.offset)
      .take(pagination.limit);

    const [entities, total] = await qb.getManyAndCount();
    return { items: entities.map((e) => this.toDomain(e)), total };
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
      entity.ean,
      entity.gtin,
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
    entity.ean = variant.ean;
    entity.gtin = variant.gtin;
    entity.createdAt = variant.createdAt;
    entity.updatedAt = variant.updatedAt;
    return entity;
  }
}

