/**
 * Category Mapping Repository
 *
 * Implements CategoryMappingRepositoryPort using TypeORM.
 * Supports per-row upsert (INSERT ON CONFLICT UPDATE) and delete,
 * unlike other mapping types which use bulk replace.
 *
 * @module libs/core/src/mappings/infrastructure/persistence/repositories
 * @implements {CategoryMappingRepositoryPort}
 */

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CategoryMappingOrmEntity } from '../entities/category-mapping.orm-entity';
import type { CategoryMappingRepositoryPort } from '../../../domain/ports/category-mapping-repository.port';
import { CategoryMapping } from '../../../domain/entities/category-mapping.entity';
import type { CategoryMappingInput } from '../../../domain/types/mapping.types';

@Injectable()
export class CategoryMappingRepository implements CategoryMappingRepositoryPort {
  constructor(
    @InjectRepository(CategoryMappingOrmEntity)
    private readonly repo: Repository<CategoryMappingOrmEntity>
  ) {}

  async findByConnectionId(connectionId: string): Promise<CategoryMapping[]> {
    const entities = await this.repo.find({ where: { connectionId } });
    return entities.map((e) => this.toDomain(e));
  }

  async findByPrestashopCategoryId(
    connectionId: string,
    prestashopCategoryId: string
  ): Promise<CategoryMapping | null> {
    const entity = await this.repo.findOne({
      where: { connectionId, prestashopCategoryId },
    });
    return entity ? this.toDomain(entity) : null;
  }

  async upsertMapping(connectionId: string, input: CategoryMappingInput): Promise<CategoryMapping> {
    // Use upsert to handle both create and update on the unique constraint
    await this.repo.upsert(
      {
        connectionId,
        prestashopCategoryId: input.prestashopCategoryId,
        allegroCategoryId: input.allegroCategoryId,
        allegroCategoryName: input.allegroCategoryName,
        allegroCategoryPath: input.allegroCategoryPath ?? null,
      },
      ['connectionId', 'prestashopCategoryId']
    );

    // Fetch the upserted entity to return with generated/updated fields
    const saved = await this.repo.findOneOrFail({
      where: { connectionId, prestashopCategoryId: input.prestashopCategoryId },
    });
    return this.toDomain(saved);
  }

  async deleteMapping(connectionId: string, prestashopCategoryId: string): Promise<void> {
    await this.repo.delete({ connectionId, prestashopCategoryId });
  }

  private toDomain(entity: CategoryMappingOrmEntity): CategoryMapping {
    return new CategoryMapping(
      entity.id,
      entity.connectionId,
      entity.prestashopCategoryId,
      entity.allegroCategoryId,
      entity.allegroCategoryName,
      entity.allegroCategoryPath
    );
  }
}
