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
import { ProductRepositoryPort } from '../../../domain/ports/product-repository.port';
import { Product } from '../../../domain/entities/product.entity';

@Injectable()
export class ProductRepository implements ProductRepositoryPort {
  constructor(
    @InjectRepository(ProductOrmEntity)
    private readonly repository: Repository<ProductOrmEntity>,
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

  async upsert(product: Product): Promise<Product> {
    const entity = this.toOrmEntity(product);
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  /**
   * Map ORM entity to domain entity
   */
  private toDomain(entity: ProductOrmEntity): Product {
    return new Product(
      entity.id,
      entity.name,
      entity.sku,
      entity.price ? Number(entity.price) : null,
      entity.description,
      entity.images,
      entity.createdAt,
      entity.updatedAt,
    );
  }

  /**
   * Map domain entity to ORM entity
   */
  private toOrmEntity(product: Product): ProductOrmEntity {
    const entity = new ProductOrmEntity();
    entity.id = product.id;
    entity.name = product.name;
    entity.sku = product.sku;
    entity.price = product.price;
    entity.description = product.description;
    entity.images = product.images;
    entity.createdAt = product.createdAt;
    entity.updatedAt = product.updatedAt;
    return entity;
  }
}

