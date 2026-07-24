/**
 * Attribute Mapping Rule Repository
 *
 * Implements AttributeMappingRuleRepositoryPort using TypeORM (#1841). Upsert is
 * find-by-id-then-save for updates and a plain insert for creates; the
 * kind-specific configuration is persisted verbatim in the `config` jsonb column
 * alongside the mirrored `kind` scalar (kept for DB-level filtering / display).
 *
 * @module libs/core/src/mappings/infrastructure/persistence/repositories
 * @implements {AttributeMappingRuleRepositoryPort}
 */

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AttributeMappingRuleOrmEntity } from '../entities/attribute-mapping-rule.orm-entity';
import type { AttributeMappingRuleRepositoryPort } from '../../../domain/ports/attribute-mapping-rule-repository.port';
import { AttributeMappingRule } from '../../../domain/entities/attribute-mapping-rule.entity';
import type { AttributeMappingRuleInput } from '../../../domain/types/attribute-mapping-rule.types';
import { AttributeMappingRuleNotFoundException } from '../../../domain/exceptions/attribute-mapping-rule-not-found.exception';

@Injectable()
export class AttributeMappingRuleRepository implements AttributeMappingRuleRepositoryPort {
  constructor(
    @InjectRepository(AttributeMappingRuleOrmEntity)
    private readonly repo: Repository<AttributeMappingRuleOrmEntity>
  ) {}

  async findByDestinationConnection(
    destinationConnectionId: string
  ): Promise<AttributeMappingRule[]> {
    const entities = await this.repo.find({
      where: { destinationConnectionId },
      order: { priority: 'ASC', id: 'ASC' },
    });
    return entities.map((e) => this.toDomain(e));
  }

  async upsertRule(
    destinationConnectionId: string,
    input: AttributeMappingRuleInput
  ): Promise<AttributeMappingRule> {
    let entity: AttributeMappingRuleOrmEntity;
    if (input.id) {
      const existing = await this.repo.findOne({
        where: { id: input.id, destinationConnectionId },
      });
      if (!existing) {
        throw new AttributeMappingRuleNotFoundException(input.id);
      }
      entity = existing;
    } else {
      entity = this.repo.create({ destinationConnectionId });
    }

    entity.destinationParameterName = input.destinationParameterName;
    entity.kind = input.config.kind;
    entity.config = input.config;
    entity.priority = input.priority;
    entity.sourceConnectionId = input.sourceConnectionId ?? null;
    entity.destinationCategoryId = input.destinationCategoryId ?? null;
    entity.manufacturerMatch = input.manufacturerMatch ?? null;
    entity.phraseMatch = input.phraseMatch ?? null;

    const saved = await this.repo.save(entity);
    return this.toDomain(saved);
  }

  async deleteRule(id: string): Promise<void> {
    await this.repo.delete({ id });
  }

  private toDomain(entity: AttributeMappingRuleOrmEntity): AttributeMappingRule {
    return new AttributeMappingRule(
      entity.id,
      entity.destinationConnectionId,
      entity.destinationParameterName,
      entity.config,
      entity.priority,
      entity.sourceConnectionId,
      entity.destinationCategoryId,
      entity.manufacturerMatch,
      entity.phraseMatch
    );
  }
}
