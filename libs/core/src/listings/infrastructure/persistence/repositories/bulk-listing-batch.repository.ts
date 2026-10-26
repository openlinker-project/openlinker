/**
 * Bulk Offer Creation Batch Repository
 *
 * TypeORM implementation of `BulkListingBatchRepositoryPort`. Handles
 * all ORM ↔ domain mapping privately; callers receive domain entities only.
 * Throws `BulkListingBatchNotFoundException` on update paths when the
 * row does not exist, and translates a unique violation on the idempotency-key
 * index into `DuplicateBulkBatchIdempotencyKeyError`.
 *
 * @module libs/core/src/listings/infrastructure/persistence/repositories
 * @implements {BulkListingBatchRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';

import { BulkListingBatch } from '../../../domain/entities/bulk-listing-batch.entity';
import { BulkListingBatchNotFoundException } from '../../../domain/exceptions/bulk-listing-batch-not-found.exception';
import { DuplicateBulkBatchIdempotencyKeyError } from '../../../domain/exceptions/duplicate-bulk-batch-idempotency-key.error';
import type { BulkListingBatchRepositoryPort } from '../../../domain/ports/bulk-listing-batch-repository.port';
import type {
  BulkBatchStatus,
  CreateBulkListingBatchInput,
} from '../../../domain/types/bulk-listing-batch.types';
import { BulkListingBatchOrmEntity } from '../entities/bulk-listing-batch.orm-entity';

/** PostgreSQL `unique_violation`. Matched by code, never by message. */
const PG_UNIQUE_VIOLATION = '23505';

const IDEMPOTENCY_KEY_CONSTRAINT = 'UQ_bulk_offer_creation_batches_connection_idempotency_key';

@Injectable()
export class BulkListingBatchRepository implements BulkListingBatchRepositoryPort {
  constructor(
    @InjectRepository(BulkListingBatchOrmEntity)
    private readonly repository: Repository<BulkListingBatchOrmEntity>,
  ) {}

  async create(input: CreateBulkListingBatchInput): Promise<BulkListingBatch> {
    const entity = this.buildOrmEntity(input);
    try {
      const saved = await this.repository.save(entity);
      return this.toDomain(saved);
    } catch (error) {
      if (input.idempotencyKey && this.isUniqueViolationOn(error, IDEMPOTENCY_KEY_CONSTRAINT)) {
        throw new DuplicateBulkBatchIdempotencyKeyError(input.connectionId, input.idempotencyKey);
      }
      throw error;
    }
  }

  async findByIdempotencyKey(
    connectionId: string,
    idempotencyKey: string
  ): Promise<BulkListingBatch | null> {
    const entity = await this.repository.findOne({ where: { connectionId, idempotencyKey } });
    return entity ? this.toDomain(entity) : null;
  }

  async clearIdempotencyKey(id: string): Promise<void> {
    await this.repository.update({ id }, { idempotencyKey: null });
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
    entity.idempotencyKey = input.idempotencyKey ?? null;
    return entity;
  }

  /**
   * Matches the SQLSTATE **and** the constraint name: the table also carries a
   * primary key, and reporting a PK collision as "this key was already used"
   * would name a state that is fine, about a constraint that did not fail.
   */
  private isUniqueViolationOn(error: unknown, constraint: string): boolean {
    if (!(error instanceof QueryFailedError)) return false;
    const readString = (source: unknown, key: 'code' | 'constraint'): string | undefined => {
      if (typeof source !== 'object' || source === null) return undefined;
      const value = (source as Record<string, unknown>)[key];
      return typeof value === 'string' ? value : undefined;
    };
    const driverError = (error as { driverError?: unknown }).driverError;
    const code = readString(error, 'code') ?? readString(driverError, 'code');
    const name = readString(error, 'constraint') ?? readString(driverError, 'constraint');
    return code === PG_UNIQUE_VIOLATION && name === constraint;
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
      entity.idempotencyKey ?? null,
    );
  }
}
