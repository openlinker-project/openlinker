/**
 * Fulfillment Routing Repository
 *
 * Implements `FulfillmentRoutingRepositoryPort` using TypeORM. `replaceForConnection`
 * uses a transaction to atomically delete + re-insert all rules for a source
 * connection (mirrors `CarrierMappingRepository`).
 *
 * @module libs/core/src/mappings/infrastructure/persistence/repositories
 * @implements {FulfillmentRoutingRepositoryPort}
 */

import { Injectable } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { FulfillmentRoutingRuleOrmEntity } from '../entities/fulfillment-routing-rule.orm-entity';
import type { FulfillmentRoutingRepositoryPort } from '../../../domain/ports/fulfillment-routing-repository.port';
import { FulfillmentRoutingRule } from '../../../domain/entities/fulfillment-routing-rule.entity';
import type { FulfillmentRoutingRuleInput } from '../../../domain/types/fulfillment-routing.types';

@Injectable()
export class FulfillmentRoutingRepository implements FulfillmentRoutingRepositoryPort {
  constructor(
    @InjectRepository(FulfillmentRoutingRuleOrmEntity)
    private readonly repo: Repository<FulfillmentRoutingRuleOrmEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async findBySourceConnectionId(sourceConnectionId: string): Promise<FulfillmentRoutingRule[]> {
    const entities = await this.repo.find({ where: { sourceConnectionId } });
    return entities.map((e) => this.toDomain(e));
  }

  async findRule(
    sourceConnectionId: string,
    sourceDeliveryMethodId: string,
  ): Promise<FulfillmentRoutingRule | null> {
    const entity = await this.repo.findOne({
      where: { sourceConnectionId, sourceDeliveryMethodId },
    });
    return entity ? this.toDomain(entity) : null;
  }

  async replaceForConnection(
    sourceConnectionId: string,
    items: FulfillmentRoutingRuleInput[],
  ): Promise<FulfillmentRoutingRule[]> {
    return this.dataSource.transaction(async (manager) => {
      await manager.delete(FulfillmentRoutingRuleOrmEntity, { sourceConnectionId });

      if (items.length === 0) {
        return [];
      }

      const entities = items.map((item) => {
        const entity = new FulfillmentRoutingRuleOrmEntity();
        entity.sourceConnectionId = sourceConnectionId;
        entity.sourceDeliveryMethodId = item.sourceDeliveryMethodId;
        entity.processorKind = item.processorKind;
        entity.processorConnectionId = item.processorConnectionId;
        return entity;
      });

      const saved = await manager.save(FulfillmentRoutingRuleOrmEntity, entities);
      return saved.map((e) => this.toDomain(e));
    });
  }

  private toDomain(entity: FulfillmentRoutingRuleOrmEntity): FulfillmentRoutingRule {
    return new FulfillmentRoutingRule(
      entity.id,
      entity.sourceConnectionId,
      entity.sourceDeliveryMethodId,
      entity.processorKind,
      entity.processorConnectionId,
      entity.createdAt,
      entity.updatedAt,
    );
  }
}
