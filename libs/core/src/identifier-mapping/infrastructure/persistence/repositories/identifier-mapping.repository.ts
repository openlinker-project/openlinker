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
import { IdentifierMappingRepositoryPort } from '../../../domain/ports/identifier-mapping-repository.port';
import { IdentifierMapping } from '../../../domain/entities/identifier-mapping.entity';
import { DuplicateIdentifierMappingError } from '../../../domain/exceptions/duplicate-identifier-mapping.error';
import { MappingContext } from '@openlinker/core/identifier-mapping';

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
    entityType: string,
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
    entityType: string,
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
   * Insert mapping with unique violation detection.
   * Used for concurrency-safe get-or-create operations.
   * The only unique constraint on this table is the external key index
   * (entityType, platformType, connectionId, externalId), so any
   * duplicate key error is converted to DuplicateIdentifierMappingError.
   * @throws DuplicateIdentifierMappingError on unique constraint violation
   */
  async insertMapping(mapping: IdentifierMapping): Promise<IdentifierMapping> {
    const entity = this.toOrmEntity(mapping);
    try {
      const saved = await this.repository.save(entity);
      return this.toDomain(saved);
    } catch (error) {
      // PostgreSQL error code 23505 = unique_violation. Using the code rather than
      // message string to avoid locale/version sensitivity.
      if (
        error instanceof QueryFailedError &&
        (error as QueryFailedError & { code?: string }).code === '23505'
      ) {
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

  async findByEntityTypeAndConnection(
    entityType: string,
    connectionId: string,
  ): Promise<IdentifierMapping[]> {
    const entities = await this.repository.find({
      where: {
        entityType,
        connectionId,
      },
    });
    return entities.map((entity: IdentifierMappingOrmEntity) => this.toDomain(entity));
  }

  async deleteByExternalKey(
    entityType: string,
    platformType: string,
    connectionId: string,
    externalId: string,
  ): Promise<void> {
    await this.repository.delete({
      entityType,
      platformType,
      connectionId,
      externalId,
    });
  }

  private toDomain(entity: IdentifierMappingOrmEntity): IdentifierMapping {
    // No `entityType` validation here. Pre-#577 this method threw on values
    // outside `EntityTypeValues`; with the boundary now widened to `string`,
    // plugin-registered entity types (Refund, Fulfilment, Subscription, …)
    // are legitimate ORM rows. The closed-set check would reject them.
    return new IdentifierMapping(
      entity.id,
      entity.entityType,
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

