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
import { BulkBatchAdvancementOrmEntity } from '../entities/bulk-batch-advancement.orm-entity';
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
    return this.applyCounterDeltas(this.repository, id, deltas);
  }

  async reclassifySucceededChildAsFailed(
    batchId: string,
    offerCreationRecordId: string,
  ): Promise<BulkListingBatch | null> {
    // One transaction for the gate and the counters: the advancement flip is
    // the at-most-once gate, so a crash after it but before the counter move
    // would leave every replay finding the row already `failed` and the batch
    // one short of its total for ever. Rolled back together, a crash leaves
    // the row `succeeded` and the next poll simply redoes the whole move.
    return this.repository.manager.transaction(async (manager) => {
      const flip = await manager
        .getRepository(BulkBatchAdvancementOrmEntity)
        .update(
          { bulkBatchId: batchId, offerCreationRecordId, outcome: 'succeeded' },
          { outcome: 'failed' },
        );
      // The `outcome = 'succeeded'` guard IS the replay gate: a second call
      // finds the row already `failed` (or no row, or a legacy NULL-outcome
      // row) and must leave the counters alone.
      if ((flip.affected ?? 0) === 0) {
        return null;
      }
      return this.applyCounterDeltas(
        manager.getRepository(BulkListingBatchOrmEntity),
        batchId,
        { succeeded: -1, failed: 1 },
      );
    });
  }

  async updateStatus(id: string, status: BulkBatchStatus): Promise<BulkListingBatch> {
    return this.updateColumns(id, { status });
  }

  async updateTotalCount(id: string, totalCount: number): Promise<BulkListingBatch> {
    return this.updateColumns(id, { totalCount });
  }

  /**
   * A narrow UPDATE of exactly the named columns, never a load-then-save of
   * the whole row: a sibling's counter increment landing between the load and
   * the save would be written back with the stale value, silently dropping
   * that child from the batch.
   */
  private async updateColumns(
    id: string,
    columns: { status?: BulkBatchStatus; totalCount?: number },
  ): Promise<BulkListingBatch> {
    const result = await this.repository.update({ id }, columns);
    if ((result.affected ?? 0) === 0) {
      throw new BulkListingBatchNotFoundException(id);
    }
    const refreshed = await this.repository.findOne({ where: { id } });
    if (!refreshed) {
      throw new BulkListingBatchNotFoundException(id);
    }
    return this.toDomain(refreshed);
  }

  /**
   * Applies every non-zero delta in ONE `UPDATE` statement, so the row never
   * holds a half-applied move (`-1 succeeded` without its `+1 failed`) that a
   * concurrent reader or a crash could observe. Deltas are bound parameters,
   * never interpolated. Takes the repository explicitly so the reclassification
   * can run it on its transaction's manager.
   */
  private async applyCounterDeltas(
    repository: Repository<BulkListingBatchOrmEntity>,
    id: string,
    deltas: { succeeded?: number; failed?: number },
  ): Promise<BulkListingBatch> {
    // Raw-SQL setters, the shape TypeORM's own `increment` uses.
    const set: { succeededCount?: () => string; failedCount?: () => string } = {};
    const parameters: Record<string, number> = {};
    if (deltas.succeeded !== undefined && deltas.succeeded !== 0) {
      set.succeededCount = () => '"succeededCount" + :succeededDelta';
      parameters.succeededDelta = deltas.succeeded;
    }
    if (deltas.failed !== undefined && deltas.failed !== 0) {
      set.failedCount = () => '"failedCount" + :failedDelta';
      parameters.failedDelta = deltas.failed;
    }
    if (Object.keys(set).length > 0) {
      const result = await repository
        .createQueryBuilder()
        .update(BulkListingBatchOrmEntity)
        .set(set)
        .where('id = :id')
        .setParameters({ id, ...parameters })
        .execute();
      if ((result.affected ?? 0) === 0) {
        throw new BulkListingBatchNotFoundException(id);
      }
    }
    const refreshed = await repository.findOne({ where: { id } });
    if (!refreshed) {
      throw new BulkListingBatchNotFoundException(id);
    }
    return this.toDomain(refreshed);
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
