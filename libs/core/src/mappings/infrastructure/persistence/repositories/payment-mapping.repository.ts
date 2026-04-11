/**
 * Payment Mapping Repository
 *
 * Implements PaymentMappingRepositoryPort using TypeORM.
 * The replaceForConnection method uses a transaction to atomically
 * delete and re-insert all mappings for a connection.
 *
 * @module libs/core/src/mappings/infrastructure/persistence/repositories
 * @implements {PaymentMappingRepositoryPort}
 */

import { Injectable } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { PaymentMappingOrmEntity } from '../entities/payment-mapping.orm-entity';
import { PaymentMappingRepositoryPort } from '../../../domain/ports/payment-mapping-repository.port';
import { PaymentMapping } from '../../../domain/entities/payment-mapping.entity';
import { PaymentMappingInput } from '../../../domain/types/mapping.types';

@Injectable()
export class PaymentMappingRepository implements PaymentMappingRepositoryPort {
  constructor(
    @InjectRepository(PaymentMappingOrmEntity)
    private readonly repo: Repository<PaymentMappingOrmEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async findByConnectionId(connectionId: string): Promise<PaymentMapping[]> {
    const entities = await this.repo.find({ where: { connectionId } });
    return entities.map((e) => this.toDomain(e));
  }

  async replaceForConnection(connectionId: string, items: PaymentMappingInput[]): Promise<PaymentMapping[]> {
    return this.dataSource.transaction(async (manager) => {
      await manager.delete(PaymentMappingOrmEntity, { connectionId });

      if (items.length === 0) {
        return [];
      }

      const entities = items.map((item) => {
        const entity = new PaymentMappingOrmEntity();
        entity.connectionId = connectionId;
        entity.allegroPaymentProvider = item.allegroPaymentProvider;
        entity.prestashopPaymentModule = item.prestashopPaymentModule;
        return entity;
      });

      const saved = await manager.save(PaymentMappingOrmEntity, entities);
      return saved.map((e) => this.toDomain(e));
    });
  }

  private toDomain(entity: PaymentMappingOrmEntity): PaymentMapping {
    return new PaymentMapping(
      entity.id,
      entity.connectionId,
      entity.allegroPaymentProvider,
      entity.prestashopPaymentModule,
    );
  }
}
