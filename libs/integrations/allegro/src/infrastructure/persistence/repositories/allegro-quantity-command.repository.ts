/**
 * Allegro Quantity Command Repository
 *
 * Repository implementation for Allegro quantity command persistence operations.
 * Provides data access methods for finding and managing command status records,
 * with conversion between domain entities and ORM entities.
 *
 * @module libs/integrations/allegro/src/infrastructure/persistence/repositories
 * @implements {AllegroQuantityCommandRepositoryPort}
 * @see {@link AllegroQuantityCommandOrmEntity} for the database entity
 * @see {@link AllegroQuantityCommandRepositoryPort} for the port interface
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryFailedError } from 'typeorm';
import { AllegroQuantityCommandOrmEntity } from '../entities/allegro-quantity-command.orm-entity';
import type {
  AllegroQuantityCommandRepositoryPort,
  AllegroQuantityCommandFilters,
} from '../../../domain/ports/allegro-quantity-command-repository.port';
import type { AllegroQuantityCommandStatus } from '../../../domain/entities/allegro-quantity-command.entity';
import { AllegroQuantityCommand } from '../../../domain/entities/allegro-quantity-command.entity';
import { DuplicateAllegroQuantityCommandError } from '../../../domain/exceptions/duplicate-allegro-quantity-command.error';
import { AllegroQuantityCommandNotFoundException } from '../../../domain/exceptions/allegro-quantity-command-not-found.error';
import { Logger } from '@openlinker/shared/logging';

@Injectable()
export class AllegroQuantityCommandRepository implements AllegroQuantityCommandRepositoryPort {
  private readonly logger = new Logger(AllegroQuantityCommandRepository.name);

  constructor(
    @InjectRepository(AllegroQuantityCommandOrmEntity)
    private readonly ormRepository: Repository<AllegroQuantityCommandOrmEntity>
  ) {}

  async findByCommandId(commandId: string): Promise<AllegroQuantityCommand | null> {
    this.logger.debug(`Finding command by commandId: ${commandId}`);

    const entity = await this.ormRepository.findOne({
      where: { commandId },
    });

    return entity ? this.toDomain(entity) : null;
  }

  async find(filters: AllegroQuantityCommandFilters): Promise<AllegroQuantityCommand[]> {
    this.logger.debug(`Finding commands with filters: ${JSON.stringify(filters)}`);

    const queryBuilder = this.ormRepository.createQueryBuilder('command');

    if (filters.connectionId) {
      queryBuilder.andWhere('command.connectionId = :connectionId', {
        connectionId: filters.connectionId,
      });
    }

    if (filters.status) {
      queryBuilder.andWhere('command.status = :status', { status: filters.status });
    }

    queryBuilder.orderBy('command.createdAt', 'DESC');

    if (filters.limit) {
      queryBuilder.limit(filters.limit);
    }

    if (filters.offset) {
      queryBuilder.offset(filters.offset);
    }

    const entities = await queryBuilder.getMany();
    return entities.map((entity) => this.toDomain(entity));
  }

  async create(command: AllegroQuantityCommand): Promise<AllegroQuantityCommand> {
    this.logger.debug(
      `Creating command record: commandId=${command.commandId}, connectionId=${command.connectionId}, offerId=${command.offerId}, status=${command.status}`
    );

    try {
      const entity = this.toOrm(command);
      const saved = await this.ormRepository.save(entity);
      this.logger.debug(`Command record created: id=${saved.id}, commandId=${saved.commandId}`);
      return this.toDomain(saved);
    } catch (error) {
      if (error instanceof QueryFailedError) {
        const errorMessage = error.message.toLowerCase();
        if (
          errorMessage.includes('unique') ||
          errorMessage.includes('duplicate') ||
          errorMessage.includes('duplicate key value')
        ) {
          this.logger.error(`Duplicate command record: commandId=${command.commandId}`);
          // Throw domain-level error instead of infrastructure error
          throw new DuplicateAllegroQuantityCommandError(command.commandId);
        }
      }
      this.logger.error(`Failed to create command record: ${(error as Error).message}`, error);
      throw error;
    }
  }

  async updateStatus(
    commandId: string,
    status: AllegroQuantityCommandStatus,
    error?: string | null
  ): Promise<AllegroQuantityCommand> {
    this.logger.debug(`Updating command status: commandId=${commandId}, status=${status}`);

    const entity = await this.ormRepository.findOne({
      where: { commandId },
    });

    if (!entity) {
      throw new AllegroQuantityCommandNotFoundException(commandId);
    }

    entity.status = status;
    entity.error = error || null;
    entity.updatedAt = new Date();

    const saved = await this.ormRepository.save(entity);
    this.logger.debug(
      `Command status updated: commandId=${saved.commandId}, status=${saved.status}`
    );
    return this.toDomain(saved);
  }

  /**
   * Convert ORM entity to domain entity
   */
  private toDomain(entity: AllegroQuantityCommandOrmEntity): AllegroQuantityCommand {
    return new AllegroQuantityCommand(
      entity.id,
      entity.commandId,
      entity.connectionId,
      entity.offerId,
      entity.quantity,
      entity.status,
      entity.error,
      entity.createdAt,
      entity.updatedAt
    );
  }

  /**
   * Convert domain entity to ORM entity
   */
  private toOrm(command: AllegroQuantityCommand): AllegroQuantityCommandOrmEntity {
    const entity = new AllegroQuantityCommandOrmEntity();
    if (command.id) {
      entity.id = command.id;
    }
    entity.commandId = command.commandId;
    entity.connectionId = command.connectionId;
    entity.offerId = command.offerId;
    entity.quantity = command.quantity;
    entity.status = command.status;
    entity.error = command.error;
    entity.createdAt = command.createdAt;
    entity.updatedAt = command.updatedAt;
    return entity;
  }
}
