/**
 * Identifier Mapping Repository
 *
 * Repository implementation for identifier mapping persistence operations.
 * Provides data access methods for finding and creating identifier mappings,
 * with conversion between domain entities and ORM entities. Includes
 * concurrency-safe insert operations with unique violation handling.
 *
 * Implements IdentifierMappingRepositoryPort to maintain proper dependency
 * direction and enable easy testing/mocking.
 *
 * @module libs/core/src/identifier-mapping/infrastructure/persistence/repositories
 * @implements {IdentifierMappingRepositoryPort}
 * @see {@link IdentifierMappingOrmEntity} for the database entity
 * @see {@link IdentifierMappingRepositoryPort} for the port interface
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryFailedError } from 'typeorm';
import { IdentifierMappingOrmEntity } from '../entities/identifier-mapping.orm-entity';
import { IdentifierMappingRepositoryPort } from '@openlinker/core/identifier-mapping/domain/ports/identifier-mapping-repository.port';
import { IdentifierMapping } from '@openlinker/core/identifier-mapping/domain/entities/identifier-mapping.entity';
import { DuplicateIdentifierMappingError } from '@openlinker/core/identifier-mapping/domain/exceptions/duplicate-identifier-mapping.error';
import {
  EntityType,
  MappingContext,
} from '@openlinker/core/identifier-mapping/domain/types/identifier-mapping.types';

@Injectable()
export class IdentifierMappingRepository implements IdentifierMappingRepositoryPort {
  constructor(
    @InjectRepository(IdentifierMappingOrmEntity)
    private readonly repository: Repository<IdentifierMappingOrmEntity>,
  ) {}

  /**
   * Find mapping by external key (entityType, platformType, connectionId, externalId)
   * Used by service after resolving platformType from Connection
   */
  async findByExternalKey(
    entityType: EntityType,
    platformType: string,
    connectionId: string,
    externalId: string,
  ): Promise<IdentifierMapping | null> {
    const entity = await this.repository.findOne({
      where: {
        entityType,
        platformType,
        connectionId,
        externalId,
      },
    });

    if (!entity) {
      return null;
    }

    return this.toDomain(entity);
  }

  async findByInternalId(
    entityType: EntityType,
    internalId: string,
  ): Promise<IdentifierMapping[]> {
    const entities = await this.repository.find({
      where: {
        entityType,
        internalId,
      },
    });

    return entities.map((entity: IdentifierMappingOrmEntity) =>
      this.toDomain(entity),
    );
  }

  /**
   * Create mapping (standard save operation)
   */
  async create(mapping: IdentifierMapping): Promise<IdentifierMapping> {
    const entity = this.toOrmEntity(mapping);
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  /**
   * Insert mapping with unique violation detection
   * Used for concurrency-safe get-or-create operations
   * @throws DuplicateIdentifierMappingError if unique constraint violation occurs
   */
  async insertMapping(mapping: IdentifierMapping): Promise<IdentifierMapping> {
    const entity = this.toOrmEntity(mapping);
    try {
      const saved = await this.repository.save(entity);
      return this.toDomain(saved);
    } catch (error) {
      // Check if it's a unique constraint violation
      if (
        error instanceof QueryFailedError &&
        error.message.includes('duplicate key value')
      ) {
        // Throw domain-level error instead of infrastructure error
        throw new DuplicateIdentifierMappingError(
          mapping.entityType,
          mapping.externalId,
          mapping.platformType,
          mapping.connectionId,
        );
      }
      throw error;
    }
  }

  private toDomain(entity: IdentifierMappingOrmEntity): IdentifierMapping {
    return new IdentifierMapping(
      entity.id,
      entity.entityType as EntityType,
      entity.internalId,
      entity.externalId,
      entity.platformType,
      entity.connectionId,
      entity.context as MappingContext | null,
      entity.createdAt,
      entity.updatedAt,
    );
  }

  private toOrmEntity(mapping: IdentifierMapping): IdentifierMappingOrmEntity {
    const entity = new IdentifierMappingOrmEntity();
    entity.id = mapping.id;
    entity.entityType = mapping.entityType;
    entity.internalId = mapping.internalId;
    entity.externalId = mapping.externalId;
    entity.platformType = mapping.platformType;
    entity.connectionId = mapping.connectionId;
    entity.context = mapping.context as Record<string, unknown> | null;
    entity.createdAt = mapping.createdAt;
    entity.updatedAt = mapping.updatedAt;
    return entity;
  }
}

