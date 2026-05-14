/**
 * Product Repository
 *
 * Repository implementation for product persistence operations.
 * Provides data access methods for finding and upserting products,
 * with conversion between domain entities and ORM entities.
 *
 * Implements ProductRepositoryPort to maintain proper dependency
 * direction and enable easy testing/mocking.
 *
 * @module libs/core/src/products/infrastructure/persistence/repositories
 * @implements {ProductRepositoryPort}
 * @see {@link ProductOrmEntity} for the database entity
 * @see {@link ProductRepositoryPort} for the port interface
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductOrmEntity } from '../entities/product.orm-entity';
import type { ProductRepositoryPort } from '../../../domain/ports/product-repository.port';
import type { Product } from '../../../domain/entities/product.entity';
import type {
  ProductListFilters,
  ProductPagination,
  PaginatedProducts,
} from '../../../domain/types/product.types';

@Injectable()
export class ProductRepository implements ProductRepositoryPort {
  constructor(
    @InjectRepository(ProductOrmEntity)
    private readonly repository: Repository<ProductOrmEntity>
  ) {}

  async findById(id: string): Promise<Product | null> {
    const entity = await this.repository.findOne({
      where: { id },
    });

    if (!entity) {
      return null;
    }

    return this.toDomain(entity);
  }

  async findMany(
    filters: ProductListFilters,
    pagination: ProductPagination
  ): Promise<PaginatedProducts> {
    const qb = this.repository.createQueryBuilder('product');

    if (filters.search) {
      const escapedSearch = filters.search.replace(/[%_]/g, '\\$&');
      qb.where('(product.name ILIKE :search OR product.sku ILIKE :search)', {
        search: `%${escapedSearch}%`,
      });
    }

    qb.orderBy('product.createdAt', 'DESC').skip(pagination.offset).take(pagination.limit);

    const [entities, total] = await qb.getManyAndCount();
    return { items: entities.map((e) => this.toDomain(e)), total };
  }

  async upsert(product: Product): Promise<Product> {
    const entity = this.toOrmEntity(product);
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  /**
   * Map ORM entity to domain entity.
   *
   * TypeORM surfaces `decimal` columns as strings; `!== null` check preserves
   * `price=0` (previously coerced to `null` via truthy shortcut).
   */
  private toDomain(entity: ProductOrmEntity): Product {
    return {
      id: entity.id,
      name: entity.name,
      sku: entity.sku,
      price: entity.price !== null ? Number(entity.price) : null,
      currency: entity.currency,
      description: entity.description,
      images: entity.images,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  /**
   * Map domain entity to ORM entity.
   *
   * Adapters may omit timestamps on first insert; TypeORM's @CreateDateColumn
   * and @UpdateDateColumn populate them in that case.
   */
  private toOrmEntity(product: Product): ProductOrmEntity {
    const entity = new ProductOrmEntity();
    entity.id = product.id;
    entity.name = product.name;
    entity.sku = product.sku;
    entity.price = product.price;
    entity.currency = product.currency;
    entity.description = product.description;
    entity.images = product.images;
    if (product.createdAt) entity.createdAt = product.createdAt;
    if (product.updatedAt) entity.updatedAt = product.updatedAt;
    return entity;
  }
}
