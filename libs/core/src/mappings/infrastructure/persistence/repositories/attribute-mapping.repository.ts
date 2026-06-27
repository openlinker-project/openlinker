/**
 * Attribute Mapping Repository
 *
 * Implements AttributeMappingRepositoryPort using TypeORM (#1038, ADR-023 §4).
 * Upsert is find-then-save (not `repo.upsert`) because uniqueness is enforced by
 * partial unique indexes over a nullable `destination_category_id`, which
 * TypeORM's `ON CONFLICT` target cannot express. The value-translation children
 * are replaced via the relation's cascade + orphan-delete on a single save.
 *
 * @module libs/core/src/mappings/infrastructure/persistence/repositories
 * @implements {AttributeMappingRepositoryPort}
 */

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AttributeMappingOrmEntity } from '../entities/attribute-mapping.orm-entity';
import { AttributeValueMappingOrmEntity } from '../entities/attribute-value-mapping.orm-entity';
import type { AttributeMappingRepositoryPort } from '../../../domain/ports/attribute-mapping-repository.port';
import { AttributeMapping } from '../../../domain/entities/attribute-mapping.entity';
import { AttributeValueMapping } from '../../../domain/entities/attribute-value-mapping.entity';
import type { AttributeMappingInput } from '../../../domain/types/mapping.types';

@Injectable()
export class AttributeMappingRepository implements AttributeMappingRepositoryPort {
  constructor(
    @InjectRepository(AttributeMappingOrmEntity)
    private readonly repo: Repository<AttributeMappingOrmEntity>
  ) {}

  async findByDestinationConnection(destinationConnectionId: string): Promise<AttributeMapping[]> {
    const entities = await this.repo.find({
      where: { destinationConnectionId },
      order: { sourceAttributeKey: 'ASC', id: 'ASC' },
    });
    return entities.map((e) => this.toDomain(e));
  }

  async findByProvenance(destinationTaxonomyProvenance: string): Promise<AttributeMapping[]> {
    // Borrowed-taxonomy reuse (#1045): every attribute mapping authored under this
    // owner provenance, across destination connections. The projection service
    // filters by source connection + category in memory, so a `borrows` destination
    // (ERLI) reuses the owner's (Allegro's) attribute mappings with zero re-authoring.
    const entities = await this.repo.find({
      where: { destinationTaxonomyProvenance },
      order: { sourceAttributeKey: 'ASC', id: 'ASC' },
    });
    return entities.map((e) => this.toDomain(e));
  }

  async upsertMapping(
    destinationConnectionId: string,
    input: AttributeMappingInput
  ): Promise<AttributeMapping> {
    const destinationCategoryId = input.destinationCategoryId ?? null;
    // Find-then-save in one transaction so the value-set replace (delete old +
    // insert new) is atomic with the parent update — a partial failure must not
    // leave a renamed parent with the wrong value rows.
    const saved = await this.repo.manager.transaction(async (em) => {
      const existing = await em.findOne(AttributeMappingOrmEntity, {
        where: {
          sourceConnectionId: input.sourceConnectionId,
          destinationConnectionId,
          sourceAttributeKey: input.sourceAttributeKey,
          destinationCategoryId:
            destinationCategoryId === null ? IsNull() : destinationCategoryId,
        },
      });

      const entity = existing ?? em.create(AttributeMappingOrmEntity, { destinationConnectionId });
      entity.sourceConnectionId = input.sourceConnectionId;
      entity.sourceAttributeKey = input.sourceAttributeKey;
      entity.destinationParameterName = input.destinationParameterName;
      entity.destinationCategoryId = destinationCategoryId;
      entity.destinationTaxonomyProvenance = input.destinationTaxonomyProvenance ?? 'allegro';

      // Clear existing value rows up front. The relation's cascade +
      // orphanedRowAction would otherwise re-insert the new set *before*
      // deleting the orphans, colliding on the (attribute_mapping_id,
      // source_value) unique index when a value (e.g. "Red") is carried across
      // the upsert.
      if (existing) {
        await em.delete(AttributeValueMappingOrmEntity, { attributeMappingId: existing.id });
      }
      entity.values = (input.values ?? []).map((v) => {
        const child = new AttributeValueMappingOrmEntity();
        child.sourceValue = v.sourceValue;
        child.destinationValue = v.destinationValue;
        return child;
      });

      const persisted = await em.save(entity);
      // Re-read so the returned children are fully hydrated (scalar
      // `attributeMappingId`, ids, timestamps) — identical to the read path.
      // Cascade-save doesn't reliably set the child FK scalar on new in-memory
      // rows.
      return em.findOneOrFail(AttributeMappingOrmEntity, { where: { id: persisted.id } });
    });
    return this.toDomain(saved);
  }

  async deleteMapping(id: string): Promise<void> {
    await this.repo.delete({ id });
  }

  private toDomain(entity: AttributeMappingOrmEntity): AttributeMapping {
    return new AttributeMapping(
      entity.id,
      entity.sourceConnectionId,
      entity.destinationConnectionId,
      entity.sourceAttributeKey,
      entity.destinationParameterName,
      entity.destinationCategoryId,
      (entity.values ?? []).map(
        (v) =>
          new AttributeValueMapping(v.id, v.attributeMappingId, v.sourceValue, v.destinationValue)
      ),
      entity.destinationTaxonomyProvenance
    );
  }
}
