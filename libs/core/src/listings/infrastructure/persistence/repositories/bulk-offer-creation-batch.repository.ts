/**
 * Bulk Offer Creation Batch Repository
 *
 * TypeORM implementation of `BulkOfferCreationBatchRepositoryPort`. Handles
 * all ORM ↔ domain mapping privately; callers receive domain entities only.
 * Throws `BulkOfferCreationBatchNotFoundException` on update paths when the
 * row does not exist.
 *
 * @module libs/core/src/listings/infrastructure/persistence/repositories
 * @implements {BulkOfferCreationBatchRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BulkOfferCreationBatch } from '../../../domain/entities/bulk-offer-creation-batch.entity';
import { BulkOfferCreationBatchNotFoundException } from '../../../domain/exceptions/bulk-offer-creation-batch-not-found.exception';
import type { BulkOfferCreationBatchRepositoryPort } from '../../../domain/ports/bulk-offer-creation-batch-repository.port';
import type {
  BulkBatchStatus,
  CreateBulkOfferCreationBatchInput,
} from '../../../domain/types/bulk-offer-creation-batch.types';
import { BulkOfferCreationBatchOrmEntity } from '../entities/bulk-offer-creation-batch.orm-entity';

@Injectable()
export class BulkOfferCreationBatchRepository implements BulkOfferCreationBatchRepositoryPort {
  constructor(
    @InjectRepository(BulkOfferCreationBatchOrmEntity)
    private readonly repository: Repository<BulkOfferCreationBatchOrmEntity>,
  ) {}

  async create(input: CreateBulkOfferCreationBatchInput): Promise<BulkOfferCreationBatch> {
    const entity = this.buildOrmEntity(input);
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  async findById(id: string): Promise<BulkOfferCreationBatch | null> {
    const entity = await this.repository.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  async incrementCounters(
    id: string,
    deltas: { succeeded?: number; failed?: number },
  ): Promise<BulkOfferCreationBatch> {
    if (deltas.succeeded !== undefined && deltas.succeeded !== 0) {
      const result = await this.repository.increment({ id }, 'succeededCount', deltas.succeeded);
      if (result.affected === 0) {
        throw new BulkOfferCreationBatchNotFoundException(id);
      }
    }
    if (deltas.failed !== undefined && deltas.failed !== 0) {
      const result = await this.repository.increment({ id }, 'failedCount', deltas.failed);
      if (result.affected === 0) {
        throw new BulkOfferCreationBatchNotFoundException(id);
      }
    }
    const refreshed = await this.repository.findOne({ where: { id } });
    if (!refreshed) {
      throw new BulkOfferCreationBatchNotFoundException(id);
    }
    return this.toDomain(refreshed);
  }

  async updateStatus(id: string, status: BulkBatchStatus): Promise<BulkOfferCreationBatch> {
    const entity = await this.repository.findOne({ where: { id } });
    if (!entity) {
      throw new BulkOfferCreationBatchNotFoundException(id);
    }
    entity.status = status;
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  private buildOrmEntity(input: CreateBulkOfferCreationBatchInput): BulkOfferCreationBatchOrmEntity {
    const entity = new BulkOfferCreationBatchOrmEntity();
    entity.connectionId = input.connectionId;
    entity.initiatedBy = input.initiatedBy;
    entity.status = 'pending';
    entity.totalCount = input.totalCount;
    entity.succeededCount = 0;
    entity.failedCount = 0;
    entity.sharedConfig = input.sharedConfig;
    return entity;
  }

  private toDomain(entity: BulkOfferCreationBatchOrmEntity): BulkOfferCreationBatch {
    return new BulkOfferCreationBatch(
      entity.id,
      entity.connectionId,
      entity.initiatedBy,
      entity.status,
      entity.totalCount,
      entity.succeededCount,
      entity.failedCount,
      entity.sharedConfig,
      entity.createdAt,
      entity.updatedAt,
    );
  }
}
