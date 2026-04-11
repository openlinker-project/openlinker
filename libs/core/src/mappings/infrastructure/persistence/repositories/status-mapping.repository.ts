/**
 * Status Mapping Repository
 *
 * Implements StatusMappingRepositoryPort using TypeORM.
 * The replaceForConnection method uses a transaction to atomically
 * delete and re-insert all mappings for a connection.
 *
 * @module libs/core/src/mappings/infrastructure/persistence/repositories
 * @implements {StatusMappingRepositoryPort}
 */

import { Injectable } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { StatusMappingOrmEntity } from '../entities/status-mapping.orm-entity';
import { StatusMappingRepositoryPort } from '../../../domain/ports/status-mapping-repository.port';
import { StatusMapping } from '../../../domain/entities/status-mapping.entity';
import { StatusMappingInput } from '../../../domain/types/mapping.types';

@Injectable()
export class StatusMappingRepository implements StatusMappingRepositoryPort {
  constructor(
    @InjectRepository(StatusMappingOrmEntity)
    private readonly repo: Repository<StatusMappingOrmEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async findByConnectionId(connectionId: string): Promise<StatusMapping[]> {
    const entities = await this.repo.find({ where: { connectionId } });
    return entities.map((e) => this.toDomain(e));
  }

  async replaceForConnection(connectionId: string, items: StatusMappingInput[]): Promise<StatusMapping[]> {
    return this.dataSource.transaction(async (manager) => {
      await manager.delete(StatusMappingOrmEntity, { connectionId });

      if (items.length === 0) {
        return [];
      }

      const entities = items.map((item) => {
        const entity = new StatusMappingOrmEntity();
        entity.connectionId = connectionId;
        entity.allegroStatus = item.allegroStatus;
        entity.prestashopStatusId = item.prestashopStatusId;
        return entity;
      });

      const saved = await manager.save(StatusMappingOrmEntity, entities);
      return saved.map((e) => this.toDomain(e));
    });
  }

  private toDomain(entity: StatusMappingOrmEntity): StatusMapping {
    return new StatusMapping(
      entity.id,
      entity.connectionId,
      entity.allegroStatus,
      entity.prestashopStatusId,
    );
  }
}
