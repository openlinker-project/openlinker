/**
 * Carrier Mapping Repository
 *
 * Implements CarrierMappingRepositoryPort using TypeORM.
 * The replaceForConnection method uses a transaction to atomically
 * delete and re-insert all mappings for a connection.
 *
 * @module libs/core/src/mappings/infrastructure/persistence/repositories
 * @implements {CarrierMappingRepositoryPort}
 */

import { Injectable } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { CarrierMappingOrmEntity } from '../entities/carrier-mapping.orm-entity';
import type { CarrierMappingRepositoryPort } from '../../../domain/ports/carrier-mapping-repository.port';
import { CarrierMapping } from '../../../domain/entities/carrier-mapping.entity';
import type { CarrierMappingInput } from '../../../domain/types/mapping.types';

@Injectable()
export class CarrierMappingRepository implements CarrierMappingRepositoryPort {
  constructor(
    @InjectRepository(CarrierMappingOrmEntity)
    private readonly repo: Repository<CarrierMappingOrmEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource
  ) {}

  async findByConnectionId(connectionId: string): Promise<CarrierMapping[]> {
    const entities = await this.repo.find({ where: { connectionId } });
    return entities.map((e) => this.toDomain(e));
  }

  async replaceForConnection(
    connectionId: string,
    items: CarrierMappingInput[]
  ): Promise<CarrierMapping[]> {
    return this.dataSource.transaction(async (manager) => {
      await manager.delete(CarrierMappingOrmEntity, { connectionId });

      if (items.length === 0) {
        return [];
      }

      const entities = items.map((item) => {
        const entity = new CarrierMappingOrmEntity();
        entity.connectionId = connectionId;
        entity.allegroDeliveryMethodId = item.allegroDeliveryMethodId;
        entity.prestashopCarrierId = item.prestashopCarrierId;
        return entity;
      });

      const saved = await manager.save(CarrierMappingOrmEntity, entities);
      return saved.map((e) => this.toDomain(e));
    });
  }

  private toDomain(entity: CarrierMappingOrmEntity): CarrierMapping {
    return new CarrierMapping(
      entity.id,
      entity.connectionId,
      entity.allegroDeliveryMethodId,
      entity.prestashopCarrierId
    );
  }
}
