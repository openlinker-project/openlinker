/**
 * Connection Repository
 *
 * Repository implementation for Connection persistence operations.
 * Provides data access methods for finding connections, with conversion
 * between domain entities and ORM entities. Implements ConnectionPort
 * interface for use by the identifier mapping service.
 *
 * @module libs/core/src/identifier-mapping/infrastructure/persistence/repositories
 * @implements {ConnectionPort}
 * @see {@link ConnectionOrmEntity} for the database entity
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConnectionOrmEntity } from '../entities/connection.orm-entity';
import { Connection } from '@openlinker/core/identifier-mapping/domain/entities/connection.entity';
import { ConnectionPort } from '@openlinker/core/identifier-mapping/domain/ports/connection.port';

@Injectable()
export class ConnectionRepository implements ConnectionPort {
  constructor(
    @InjectRepository(ConnectionOrmEntity)
    private readonly repository: Repository<ConnectionOrmEntity>,
  ) {}

  async get(connectionId: string): Promise<Connection> {
    const entity = await this.repository.findOne({
      where: { id: connectionId },
    });

    if (!entity) {
      throw new NotFoundException(`Connection not found: ${connectionId}`);
    }

    return this.toDomain(entity);
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
    );
  }
}

