/**
 * Order State Mapping Repository
 *
 * Implements OrderStateMappingRepositoryPort using TypeORM. `replaceForConnection`
 * uses a transaction to atomically delete and re-insert all mappings for a
 * connection (#862), mirroring the carrier-mapping repository.
 *
 * @module libs/core/src/mappings/infrastructure/persistence/repositories
 * @implements {OrderStateMappingRepositoryPort}
 */

import { Injectable } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import type { OrderStatus } from '@openlinker/core/orders';
import { OrderStateMappingOrmEntity } from '../entities/order-state-mapping.orm-entity';
import type { OrderStateMappingRepositoryPort } from '../../../domain/ports/order-state-mapping-repository.port';
import { OrderStateMapping } from '../../../domain/entities/order-state-mapping.entity';
import type { OrderStateMappingInput } from '../../../domain/types/mapping.types';

@Injectable()
export class OrderStateMappingRepository implements OrderStateMappingRepositoryPort {
  constructor(
    @InjectRepository(OrderStateMappingOrmEntity)
    private readonly repo: Repository<OrderStateMappingOrmEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource
  ) {}

  async findByConnectionId(connectionId: string): Promise<OrderStateMapping[]> {
    const entities = await this.repo.find({ where: { connectionId } });
    return entities.map((e) => this.toDomain(e));
  }

  async replaceForConnection(
    connectionId: string,
    items: OrderStateMappingInput[]
  ): Promise<OrderStateMapping[]> {
    return this.dataSource.transaction(async (manager) => {
      await manager.delete(OrderStateMappingOrmEntity, { connectionId });

      if (items.length === 0) {
        return [];
      }

      const entities = items.map((item) => {
        const entity = new OrderStateMappingOrmEntity();
        entity.connectionId = connectionId;
        entity.olStatus = item.olStatus;
        entity.externalStateId = item.externalStateId;
        return entity;
      });

      const saved = await manager.save(OrderStateMappingOrmEntity, entities);
      return saved.map((e) => this.toDomain(e));
    });
  }

  private toDomain(entity: OrderStateMappingOrmEntity): OrderStateMapping {
    // `ol_status` is constrained to the OrderStatus union at the API boundary
    // (@IsIn(OrderStatusValues)) + the unique index; the column is a plain
    // varchar, so narrow on read.
    return new OrderStateMapping(
      entity.id,
      entity.connectionId,
      entity.olStatus as OrderStatus,
      entity.externalStateId
    );
  }
}
