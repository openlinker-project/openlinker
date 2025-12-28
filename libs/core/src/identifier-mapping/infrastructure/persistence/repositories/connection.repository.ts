/**
 * Connection Repository
 *
 * Repository implementation for Connection persistence operations.
 * Provides data access methods for CRUD operations on connections, with conversion
 * between domain entities and ORM entities. Implements ConnectionPort interface
 * for use by the identifier mapping service and integrations service.
 *
 * @module libs/core/src/identifier-mapping/infrastructure/persistence/repositories
 * @implements {ConnectionPort}
 * @see {@link ConnectionOrmEntity} for the database entity
 * @see {@link ConnectionPort} for the port interface
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryFailedError } from 'typeorm';
import { ConnectionOrmEntity } from '../entities/connection.orm-entity';
import { Connection } from '@openlinker/core/identifier-mapping/domain/entities/connection.entity';
import { ConnectionPort } from '@openlinker/core/identifier-mapping/domain/ports/connection.port';
import {
  ConnectionCreate,
  ConnectionUpdate,
  ConnectionFilters,
} from '@openlinker/core/identifier-mapping/domain/types/connection.types';
import { ConnectionNotFoundException } from '@openlinker/core/identifier-mapping/domain/exceptions/connection-not-found.exception';
import { Logger } from '@openlinker/shared/logging';

@Injectable()
export class ConnectionRepository implements ConnectionPort {
  private readonly logger = new Logger(ConnectionRepository.name);

  constructor(
    @InjectRepository(ConnectionOrmEntity)
    private readonly repository: Repository<ConnectionOrmEntity>,
  ) {}

  async get(connectionId: string): Promise<Connection> {
    try {
      const entity = await this.repository.findOne({
        where: { id: connectionId },
      });

      if (!entity) {
        throw new ConnectionNotFoundException(connectionId);
      }

      return this.toDomain(entity);
    } catch (error) {
      // Handle invalid UUID format - PostgreSQL throws QueryFailedError
      // when trying to query with a non-UUID string
      if (
        error instanceof QueryFailedError &&
        'code' in error &&
        error.code === '22P02' // PostgreSQL invalid input syntax error code
      ) {
        throw new ConnectionNotFoundException(connectionId);
      }
      // Re-throw other errors (including ConnectionNotFoundException)
      throw error;
    }
  }

  async list(filters?: ConnectionFilters): Promise<Connection[]> {
    const queryBuilder = this.repository.createQueryBuilder('connection');

    if (filters?.platformType) {
      queryBuilder.andWhere('connection.platformType = :platformType', {
        platformType: filters.platformType,
      });
    }

    if (filters?.status) {
      queryBuilder.andWhere('connection.status = :status', {
        status: filters.status,
      });
    }

    const entities = await queryBuilder.getMany();
    return entities.map((entity) => this.toDomain(entity));
  }

  async create(payload: ConnectionCreate): Promise<Connection> {
    this.logger.debug(`Creating connection: ${payload.name} (platform: ${payload.platformType})`);
    const entity = this.toOrm(payload);
    const saved = await this.repository.save(entity);
    const connection = this.toDomain(saved);
    this.logger.log(`Connection created: ${connection.id} (${connection.name})`);
    return connection;
  }

  async update(
    connectionId: string,
    patch: ConnectionUpdate,
  ): Promise<Connection> {
    try {
      // Load existing entity
      const existing = await this.repository.findOne({
        where: { id: connectionId },
      });

      if (!existing) {
        throw new ConnectionNotFoundException(connectionId);
      }

    // Apply patch
    if (patch.name !== undefined) {
      existing.name = patch.name;
    }
    if (patch.status !== undefined) {
      existing.status = patch.status;
    }
    if (patch.config !== undefined) {
      existing.config = patch.config as Record<string, unknown>;
    }
    if (patch.adapterKey !== undefined) {
      existing.adapterKey = patch.adapterKey;
    }

      // Save updated entity
      const saved = await this.repository.save(existing);
      return this.toDomain(saved);
    } catch (error) {
      // Handle invalid UUID format - PostgreSQL throws QueryFailedError
      // when trying to query with a non-UUID string
      if (
        error instanceof QueryFailedError &&
        'code' in error &&
        error.code === '22P02' // PostgreSQL invalid input syntax error code
      ) {
        throw new ConnectionNotFoundException(connectionId);
      }
      // Re-throw other errors (including ConnectionNotFoundException)
      throw error;
    }
  }

  async disable(connectionId: string): Promise<Connection> {
    return this.update(connectionId, { status: 'disabled' });
  }

  private toDomain(entity: ConnectionOrmEntity): Connection {
    return new Connection(
      entity.id,
      entity.platformType,
      entity.name,
      entity.status as 'active' | 'disabled' | 'error',
      entity.config,
      entity.credentialsRef,
      entity.createdAt,
      entity.updatedAt,
      entity.adapterKey,
    );
  }

  private toOrm(
    payload: ConnectionCreate | ConnectionOrmEntity,
  ): ConnectionOrmEntity {
    const entity = new ConnectionOrmEntity();

    if ('id' in payload) {
      // Existing entity
      entity.id = payload.id;
      entity.platformType = payload.platformType;
      entity.name = payload.name;
      entity.status = payload.status;
      entity.config = payload.config;
      entity.credentialsRef = payload.credentialsRef;
      entity.adapterKey = payload.adapterKey;
      entity.createdAt = payload.createdAt;
      entity.updatedAt = payload.updatedAt;
    } else {
      // New entity from ConnectionCreate
      entity.platformType = payload.platformType;
      entity.name = payload.name;
      entity.status = 'active'; // Default status
      entity.config = payload.config;
      entity.credentialsRef = payload.credentialsRef;
      entity.adapterKey = payload.adapterKey;
    }

    return entity;
  }
}

