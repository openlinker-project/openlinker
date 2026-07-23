/**
 * Bulk Offer Creation Batch Repository
 *
 * TypeORM implementation of `BulkListingBatchRepositoryPort`. Handles
 * all ORM ↔ domain mapping privately; callers receive domain entities only.
 * Throws `BulkListingBatchNotFoundException` on update paths when the
 * row does not exist.
 *
 * @module libs/core/src/listings/infrastructure/persistence/repositories
 * @implements {BulkListingBatchRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BulkListingBatch } from '../../../domain/entities/bulk-listing-batch.entity';
import { BulkListingBatchNotFoundException } from '../../../domain/exceptions/bulk-listing-batch-not-found.exception';
import type { BulkListingBatchRepositoryPort } from '../../../domain/ports/bulk-listing-batch-repository.port';
import type {
  BulkBatchStatus,
  CreateBulkListingBatchInput,
} from '../../../domain/types/bulk-listing-batch.types';
import { BulkListingBatchOrmEntity } from '../entities/bulk-listing-batch.orm-entity';

@Injectable()
export class BulkListingBatchRepository implements BulkListingBatchRepositoryPort {
  constructor(
    @InjectRepository(BulkListingBatchOrmEntity)
    private readonly repository: Repository<BulkListingBatchOrmEntity>,
  ) {}

  async create(input: CreateBulkListingBatchInput): Promise<BulkListingBatch> {
    const entity = this.buildOrmEntity(input);
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  async findById(id: string): Promise<BulkListingBatch | null> {
    const entity = await this.repository.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  async incrementCounters(
    id: string,
    deltas: { succeeded?: number; failed?: number },
  ): Promise<BulkListingBatch> {
    if (deltas.succeeded !== undefined && deltas.succeeded !== 0) {
      const result = await this.repository.increment({ id }, 'succeededCount', deltas.succeeded);
      if (result.affected === 0) {
        throw new BulkListingBatchNotFoundException(id);
      }
    }
    if (deltas.failed !== undefined && deltas.failed !== 0) {
      const result = await this.repository.increment({ id }, 'failedCount', deltas.failed);
      if (result.affected === 0) {
        throw new BulkListingBatchNotFoundException(id);
      }
    }
    const refreshed = await this.repository.findOne({ where: { id } });
    if (!refreshed) {
      throw new BulkListingBatchNotFoundException(id);
    }
    return this.toDomain(refreshed);
  }

  async updateStatus(id: string, status: BulkBatchStatus): Promise<BulkListingBatch> {
    const entity = await this.repository.findOne({ where: { id } });
    if (!entity) {
      throw new BulkListingBatchNotFoundException(id);
    }
    entity.status = status;
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  async updateTotalCount(id: string, totalCount: number): Promise<BulkListingBatch> {
    const entity = await this.repository.findOne({ where: { id } });
    if (!entity) {
      throw new BulkListingBatchNotFoundException(id);
    }
    entity.totalCount = totalCount;
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  private buildOrmEntity(input: CreateBulkListingBatchInput): BulkListingBatchOrmEntity {
    const entity = new BulkListingBatchOrmEntity();
    entity.connectionId = input.connectionId;
    entity.initiatedBy = input.initiatedBy;
    entity.status = 'pending';
    entity.totalCount = input.totalCount;
    entity.succeededCount = 0;
    entity.failedCount = 0;
    entity.sharedConfig = input.sharedConfig;
    return entity;
  }

  private toDomain(entity: BulkListingBatchOrmEntity): BulkListingBatch {
    return new BulkListingBatch(
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
