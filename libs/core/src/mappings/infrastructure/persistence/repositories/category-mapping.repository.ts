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
import { In, IsNull, Repository } from 'typeorm';
import { Logger } from '@openlinker/shared/logging';
import { CategoryMappingOrmEntity } from '../entities/category-mapping.orm-entity';
import type { CategoryMappingRepositoryPort } from '../../../domain/ports/category-mapping-repository.port';
import { CategoryMapping } from '../../../domain/entities/category-mapping.entity';
import type {
  CategoryMappingInput,
  CategoryMappingReassignResult,
} from '../../../domain/types/mapping.types';

@Injectable()
export class CategoryMappingRepository implements CategoryMappingRepositoryPort {
  private readonly logger = new Logger(CategoryMappingRepository.name);

  constructor(
    @InjectRepository(CategoryMappingOrmEntity)
    private readonly repo: Repository<CategoryMappingOrmEntity>
  ) {}

  async findByDestinationConnection(
    destinationConnectionId: string,
    sourceConnectionId?: string
  ): Promise<CategoryMapping[]> {
    if (sourceConnectionId === undefined) {
      const entities = await this.repo.find({ where: { destinationConnectionId } });
      return entities.map((e) => this.toDomain(e));
    }
    const entities = await this.repo.find({
      where: [
        { destinationConnectionId, sourceConnectionId },
        { destinationConnectionId, sourceConnectionId: IsNull() },
      ],
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const bySourceCategory = new Map<string, CategoryMappingOrmEntity>();
    for (const entity of entities) {
      const current = bySourceCategory.get(entity.sourceCategoryId);
      if (!current || (current.sourceConnectionId === null && entity.sourceConnectionId !== null)) {
        bySourceCategory.set(entity.sourceCategoryId, entity);
      }
    }
    return [...bySourceCategory.values()].map((e) => this.toDomain(e));
  }

  async findBySourceCategory(
    destinationConnectionId: string,
    sourceCategoryId: string,
    sourceConnectionId?: string | null
  ): Promise<CategoryMapping | null> {
    // Deterministic order (#1036): the schema permits >1 row per
    // (destination, source category) across source stores; oldest-wins keeps
    // resolution stable, and a warning surfaces the ambiguity.
    const where =
      sourceConnectionId != null
        ? [
            { destinationConnectionId, sourceCategoryId, sourceConnectionId },
            { destinationConnectionId, sourceCategoryId, sourceConnectionId: IsNull() },
          ]
        : { destinationConnectionId, sourceCategoryId };
    const found = await this.repo.find({ where, order: { createdAt: 'ASC', id: 'ASC' } });
    // The source's own row beats a source-agnostic one, whatever their ages.
    const matches =
      sourceConnectionId != null
        ? [
            ...found.filter((e) => e.sourceConnectionId !== null),
            ...found.filter((e) => e.sourceConnectionId === null),
          ]
        : found;
    if (matches.length > 1) {
      this.logger.warn(
        `Ambiguous category mapping: ${matches.length} rows for destination=${destinationConnectionId} sourceCategory=${sourceCategoryId} sourceConnection=${sourceConnectionId ?? 'any'}; using id=${matches[0].id}.`
      );
    }
    return matches[0] ? this.toDomain(matches[0]) : null;
  }

  async findBySourceCategoryByProvenance(
    destinationTaxonomyProvenance: string,
    sourceCategoryId: string,
    sourceConnectionId?: string | null
  ): Promise<CategoryMapping | null> {
    // Borrowed-taxonomy reuse (#1045): resolve against any destination connection
    // that authored a row under this owner provenance. When the source store is
    // known, match it OR the source-agnostic (NULL) historical rows — a NULL-source
    // row is a wildcard that applies to any source store.
    const where =
      sourceConnectionId != null
        ? [
            { destinationTaxonomyProvenance, sourceCategoryId, sourceConnectionId },
            { destinationTaxonomyProvenance, sourceCategoryId, sourceConnectionId: IsNull() },
          ]
        : { destinationTaxonomyProvenance, sourceCategoryId };
    const matches = await this.repo.find({
      where,
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    if (matches.length > 1) {
      this.logger.warn(
        `Ambiguous borrowed-taxonomy category mapping: ${matches.length} rows for provenance=${destinationTaxonomyProvenance} sourceCategory=${sourceCategoryId} sourceConnection=${sourceConnectionId ?? 'any'}; using oldest (id=${matches[0].id}). Source-connection scoping is a follow-up.`
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

  async deleteMapping(
    destinationConnectionId: string,
    sourceCategoryId: string,
    sourceConnectionId?: string
  ): Promise<void> {
    if (sourceConnectionId === undefined) {
      await this.repo.delete({ destinationConnectionId, sourceCategoryId });
      return;
    }
    // The NULL-source row is the fallback for every other source; it is not
    // this source's to remove.
    await this.repo.delete({ destinationConnectionId, sourceCategoryId, sourceConnectionId });
  }

  async reassignDestination(
    fromDestinationConnectionId: string,
    toDestinationConnectionId: string
  ): Promise<CategoryMappingReassignResult> {
    // Every row would clash with itself and be dropped as "kept".
    if (fromDestinationConnectionId === toDestinationConnectionId) {
      return { moved: 0, keptSourceCategoryIds: [] };
    }
    return this.repo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(CategoryMappingOrmEntity);
      const moving = await repo.find({
        where: { destinationConnectionId: fromDestinationConnectionId },
        order: { createdAt: 'ASC', id: 'ASC' },
      });
      if (moving.length === 0) {
        return { moved: 0, keptSourceCategoryIds: [] };
      }
      const existing = await repo.find({
        where: {
          destinationConnectionId: toDestinationConnectionId,
          sourceCategoryId: In(moving.map((e) => e.sourceCategoryId)),
        },
      });

      let moved = 0;
      const kept: string[] = [];
      for (const entity of moving) {
        // A row written under the master's own id has no source: the old
        // destination WAS the source store, so it becomes the source here.
        const sourceConnectionId = entity.sourceConnectionId ?? fromDestinationConnectionId;
        const clash = existing.some(
          (e) =>
            e.sourceCategoryId === entity.sourceCategoryId &&
            (e.sourceConnectionId === sourceConnectionId || e.sourceConnectionId === null)
        );
        if (clash) {
          kept.push(entity.sourceCategoryId);
          await repo.delete({ id: entity.id });
          continue;
        }
        entity.destinationConnectionId = toDestinationConnectionId;
        entity.sourceConnectionId = sourceConnectionId;
        await repo.save(entity);
        moved += 1;
      }
      return { moved, keptSourceCategoryIds: kept };
    });
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
