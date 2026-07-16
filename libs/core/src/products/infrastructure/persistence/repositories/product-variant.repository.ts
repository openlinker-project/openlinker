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
import type { ProductVariantRepositoryPort } from '../../../domain/ports/product-variant-repository.port';
import type { ProductVariant } from '../../../domain/entities/product-variant.entity';
import type {
  ProductVariantListFilters,
  ProductPagination,
  PaginatedProductVariants,
} from '../../../domain/types/product.types';
import { normalizeBarcode, normalizeToEan13 } from '../../../domain/utils/barcode-normalization';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';

@Injectable()
export class ProductVariantRepository implements ProductVariantRepositoryPort {
  constructor(
    @InjectRepository(ProductVariantOrmEntity)
    private readonly repository: Repository<ProductVariantOrmEntity>
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
    field: 'ean' | 'gtin'
  ): Promise<ProductVariant[]> {
    const normalizedValues = [
      ...new Set(
        values.flatMap((value) => {
          if (field === 'ean') {
            // normalizeToEan13 converts UPC-A (12-digit) → EAN-13; search both forms
            // so rows inserted before the normalization fix are still found.
            const ean13 = normalizeToEan13(value);
            const raw = normalizeBarcode(value);
            if (!ean13 && !raw) return [];
            return [...new Set([ean13, raw].filter((v): v is string => !!v))];
          }
          const normalized = normalizeBarcode(value);
          return normalized ? [normalized] : [];
        })
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
        `,
        {
          connectionId,
          entityType: CORE_ENTITY_TYPE.ProductVariant,
        }
      )
      .where(
        new Brackets((qb) => {
          qb.where(`variant.${field} IN (:...values)`, { values: normalizedValues }).orWhere(
            `(variant.${field} IS NULL AND variant.attributes ->> '${attributeKey}' IN (:...values))`,
            { values: normalizedValues }
          );
        })
      )
      .getMany();

    return entities.map((entity) => this.toDomain(entity));
  }

  async findMany(
    filters: ProductVariantListFilters,
    pagination: ProductPagination
  ): Promise<PaginatedProductVariants> {
    const qb = this.repository.createQueryBuilder('variant');

    if (filters.productId) {
      qb.andWhere('variant.productId = :productId', { productId: filters.productId });
    }

    if (filters.search) {
      const escapedSearch = filters.search.replace(/[%_]/g, '\\$&');
      qb.andWhere(
        '(variant.sku ILIKE :search OR variant.ean ILIKE :search OR variant.gtin ILIKE :search)',
        { search: `%${escapedSearch}%` }
      );
    }

    if (filters.connectionId) {
      qb.innerJoin(
        'identifier_mappings',
        'mapping',
        `mapping.internalId = variant.id AND mapping.connectionId = :connectionId AND mapping.entityType = :entityType`,
        { connectionId: filters.connectionId, entityType: CORE_ENTITY_TYPE.ProductVariant }
      );
    }

    if (filters.hasIdentifiers) {
      qb.andWhere(
        '(variant.ean IS NOT NULL OR variant.gtin IS NOT NULL OR variant.sku IS NOT NULL)'
      );
    }

    qb.orderBy('variant.createdAt', 'DESC').skip(pagination.offset).take(pagination.limit);

    const [entities, total] = await qb.getManyAndCount();
    return { items: entities.map((e) => this.toDomain(e)), total };
  }

  /**
   * Soft-mark every live variant of `productId` that is NOT in `keepVariantIds`
   * as stale (#1599), returning the ids actually flipped. Mirrors the inventory
   * `markStaleExceptVariants` intent, but `product_variants` is keyed by a
   * non-null `id` PK, so no three-valued NULL handling is needed. An empty
   * keep-set marks EVERY live row (the product-fully-deleted / 404 path) — the
   * `NOT IN` clause is only appended when there is something to keep, because
   * `id NOT IN ()` is invalid SQL. Already-stale rows are skipped so `staleAt`
   * keeps the first-marked timestamp.
   */
  async markStaleExceptVariants(
    productId: string,
    keepVariantIds: readonly string[]
  ): Promise<string[]> {
    const qb = this.repository
      .createQueryBuilder()
      .update(ProductVariantOrmEntity)
      .set({ isStale: true, staleAt: () => 'NOW()' })
      .where('productId = :productId', { productId })
      .andWhere('isStale = false');

    if (keepVariantIds.length > 0) {
      qb.andWhere('id NOT IN (:...keep)', { keep: [...keepVariantIds] });
    }

    // Array form of `.returning(...)` — resolves column metadata and emits a
    // quoted identifier. (The string form produces the same quoted SQL in
    // TypeORM 0.3.17's UpdateQueryBuilder, but the array form is the documented,
    // version-robust way and matches the sibling inventory repository.)
    const result = await qb.returning(['id']).execute();
    const raw = result.raw as { id: string }[];
    return raw.map((row) => row.id);
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
          `Cannot save variants: Product with id ${productId} does not exist. Ensure product is saved before variants.`
        );
      }
      throw error;
    }
  }

  /**
   * Map ORM entity to domain entity.
   *
   * TypeORM surfaces `decimal` columns as strings; `!== null` preserves
   * `price=0` (a truthy shortcut would coerce it to `undefined`). Null on
   * the ORM side becomes `undefined` on the domain side to match the
   * optional `ProductVariant.price?: number` shape — see the entity comment.
   */
  private toDomain(entity: ProductVariantOrmEntity): ProductVariant {
    return {
      id: entity.id,
      productId: entity.productId,
      sku: entity.sku,
      attributes: entity.attributes,
      ean: entity.ean,
      gtin: entity.gtin,
      price: entity.price !== null ? Number(entity.price) : undefined,
      isStale: entity.isStale,
      staleAt: entity.staleAt,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
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
    entity.price = variant.price ?? null;
    // Un-stale on reappearance: a master re-sync builds the domain variant
    // without staleness set, so upsert clears the flag (#1599). Callers that
    // intend to mark stale use markStaleExceptVariants, not upsert.
    entity.isStale = variant.isStale ?? false;
    entity.staleAt = variant.staleAt ?? null;
    // Adapters may omit timestamps on first insert; TypeORM's @CreateDateColumn
    // and @UpdateDateColumn populate them in that case.
    if (variant.createdAt) entity.createdAt = variant.createdAt;
    if (variant.updatedAt) entity.updatedAt = variant.updatedAt;
    return entity;
  }
}
