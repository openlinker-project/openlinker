/**
 * Connection Cursor Repository
 *
 * Repository implementation for connection cursor persistence operations.
 * Provides data access methods for getting, setting, and deleting cursor values
 * per connection. Uses TypeORM with upsert semantics for atomic cursor updates.
 *
 * Implements ConnectionCursorRepositoryPort to maintain proper dependency
 * direction and enable easy testing/mocking.
 *
 * @module libs/core/src/sync/infrastructure/persistence/repositories
 * @implements {ConnectionCursorRepositoryPort}
 * @see {@link ConnectionCursorOrmEntity} for the database entity
 * @see {@link ConnectionCursorRepositoryPort} for the port interface
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryFailedError } from 'typeorm';
import { ConnectionCursorOrmEntity } from '../entities/connection-cursor.orm-entity';
import { ConnectionCursorRepositoryPort } from '../../../domain/ports/connection-cursor-repository.port';
import { Logger } from '@openlinker/shared/logging';

@Injectable()
export class ConnectionCursorRepository implements ConnectionCursorRepositoryPort {
  private readonly logger = new Logger(ConnectionCursorRepository.name);

  constructor(
    @InjectRepository(ConnectionCursorOrmEntity)
    private readonly repository: Repository<ConnectionCursorOrmEntity>,
  ) {}

  async get(connectionId: string, cursorKey: string): Promise<string | null> {
    try {
      const entity = await this.repository.findOne({
        where: { connectionId, cursorKey },
      });

      this.logger.debug(
        `Retrieved cursor ${cursorKey} for connection ${connectionId}: ${entity ? 'found' : 'not found'}`,
      );

      return entity?.value ?? null;
    } catch (error) {
      // Handle infrastructure errors (e.g., invalid UUID format)
      if (error instanceof QueryFailedError) {
        this.logger.warn(
          `Failed to get cursor ${cursorKey} for connection ${connectionId}: ${error.message}`,
        );
        // Return null for invalid connectionId (treats as "not found")
        return null;
      }
      throw error;
    }
  }

  async set(connectionId: string, cursorKey: string, value: string): Promise<void> {
    try {
      // Use upsert for atomic create-or-update
      await this.repository.upsert(
        {
          connectionId,
          cursorKey,
          value,
        },
        {
          conflictPaths: ['connectionId', 'cursorKey'],
        },
      );

      this.logger.debug(
        `Set cursor ${cursorKey} for connection ${connectionId} to value: ${value}`,
      );
    } catch (error) {
      // Handle infrastructure errors (e.g., invalid UUID format, constraint violations)
      if (error instanceof QueryFailedError) {
        this.logger.error(
          `Failed to set cursor ${cursorKey} for connection ${connectionId}: ${error.message}`,
        );
        throw new Error(
          `Failed to set cursor ${cursorKey} for connection ${connectionId}: ${error.message}`,
        );
      }
      throw error;
    }
  }

  async delete(connectionId: string, cursorKey: string): Promise<void> {
    try {
      await this.repository.delete({
        connectionId,
        cursorKey,
      });

      this.logger.debug(
        `Deleted cursor ${cursorKey} for connection ${connectionId}`,
      );
    } catch (error) {
      // Handle infrastructure errors (e.g., invalid UUID format)
      if (error instanceof QueryFailedError) {
        this.logger.warn(
          `Failed to delete cursor ${cursorKey} for connection ${connectionId}: ${error.message}`,
        );
        // Swallow error for delete operations (idempotent - cursor may not exist)
        return;
      }
      throw error;
    }
  }
}

