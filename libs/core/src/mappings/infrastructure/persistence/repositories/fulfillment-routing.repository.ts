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
import {
  normalizeParcelProfile,
  type FulfillmentParcelProfile,
  type FulfillmentRoutingRuleInput,
} from '../../../domain/types/fulfillment-routing.types';

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
        // The service already rejected a partial box; an unnormalisable value
        // degrades to "no profile" here rather than persisting half a shape.
        const normalized = normalizeParcelProfile(item.parcelProfile);
        const profile = normalized === 'incomplete-dimensions' ? null : normalized;
        entity.parcelTemplate = profile?.parcelTemplate ?? null;
        entity.parcelLengthMm = profile?.lengthMm ?? null;
        entity.parcelWidthMm = profile?.widthMm ?? null;
        entity.parcelHeightMm = profile?.heightMm ?? null;
        entity.parcelDefaultWeightGrams = profile?.defaultWeightGrams ?? null;
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
      this.toParcelProfile(entity),
    );
  }

  private toParcelProfile(entity: FulfillmentRoutingRuleOrmEntity): FulfillmentParcelProfile | null {
    const normalized = normalizeParcelProfile({
      parcelTemplate: entity.parcelTemplate,
      lengthMm: entity.parcelLengthMm,
      widthMm: entity.parcelWidthMm,
      heightMm: entity.parcelHeightMm,
      defaultWeightGrams: entity.parcelDefaultWeightGrams,
    });
    return normalized === 'incomplete-dimensions' ? null : normalized;
  }
}
