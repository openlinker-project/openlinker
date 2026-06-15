/**
 * Category Mapping Repository
 *
 * Implements CategoryMappingRepositoryPort using TypeORM. Supports per-row
 * upsert and delete, unlike other mapping types which use bulk replace.
 *
 * Neutralised in #1036 (ADR-023 §2). Upsert is implemented as find-then-save
 * (not `repo.upsert`) because uniqueness is enforced by partial unique indexes
 * over a nullable `source_connection_id`, which TypeORM's `ON CONFLICT` target
 * cannot express; an admin config endpoint has no concurrency that warrants
 * raw-SQL upsert.
 *
 * @module libs/core/src/mappings/infrastructure/persistence/repositories
 * @implements {CategoryMappingRepositoryPort}
 */

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Logger } from '@openlinker/shared/logging';
import { CategoryMappingOrmEntity } from '../entities/category-mapping.orm-entity';
import type { CategoryMappingRepositoryPort } from '../../../domain/ports/category-mapping-repository.port';
import { CategoryMapping } from '../../../domain/entities/category-mapping.entity';
import type { CategoryMappingInput } from '../../../domain/types/mapping.types';

@Injectable()
export class CategoryMappingRepository implements CategoryMappingRepositoryPort {
  private readonly logger = new Logger(CategoryMappingRepository.name);

  constructor(
    @InjectRepository(CategoryMappingOrmEntity)
    private readonly repo: Repository<CategoryMappingOrmEntity>
  ) {}

  async findByDestinationConnection(destinationConnectionId: string): Promise<CategoryMapping[]> {
    const entities = await this.repo.find({ where: { destinationConnectionId } });
    return entities.map((e) => this.toDomain(e));
  }

  async findBySourceCategory(
    destinationConnectionId: string,
    sourceCategoryId: string
  ): Promise<CategoryMapping | null> {
    // Deterministic order (#1036): the schema permits >1 row per
    // (destination, source category) across source stores; oldest-wins keeps
    // resolution stable, and a warning surfaces the ambiguity until
    // source-connection-scoped lookup lands.
    const matches = await this.repo.find({
      where: { destinationConnectionId, sourceCategoryId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    if (matches.length > 1) {
      this.logger.warn(
        `Ambiguous category mapping: ${matches.length} rows for destination=${destinationConnectionId} sourceCategory=${sourceCategoryId}; using oldest (id=${matches[0].id}). Source-connection scoping is a follow-up.`
      );
    }
    return matches[0] ? this.toDomain(matches[0]) : null;
  }

  async upsertMapping(
    destinationConnectionId: string,
    input: CategoryMappingInput
  ): Promise<CategoryMapping> {
    const sourceConnectionId = input.sourceConnectionId ?? null;
    const existing = await this.repo.findOne({
      where: {
        destinationConnectionId,
        sourceCategoryId: input.sourceCategoryId,
        sourceConnectionId: sourceConnectionId === null ? IsNull() : sourceConnectionId,
      },
    });

    const entity = existing ?? this.repo.create({ destinationConnectionId });
    entity.sourceConnectionId = sourceConnectionId;
    entity.sourceCategoryId = input.sourceCategoryId;
    entity.destinationCategoryId = input.destinationCategoryId;
    entity.destinationCategoryName = input.destinationCategoryName;
    entity.destinationCategoryPath = input.destinationCategoryPath ?? null;
    entity.destinationTaxonomyProvenance = input.destinationTaxonomyProvenance ?? 'allegro';

    const saved = await this.repo.save(entity);
    return this.toDomain(saved);
  }

  async deleteMapping(destinationConnectionId: string, sourceCategoryId: string): Promise<void> {
    await this.repo.delete({ destinationConnectionId, sourceCategoryId });
  }

  private toDomain(entity: CategoryMappingOrmEntity): CategoryMapping {
    return new CategoryMapping(
      entity.id,
      entity.sourceConnectionId,
      entity.destinationConnectionId,
      entity.sourceCategoryId,
      entity.destinationCategoryId,
      entity.destinationCategoryName,
      entity.destinationCategoryPath,
      entity.destinationTaxonomyProvenance
    );
  }
}
