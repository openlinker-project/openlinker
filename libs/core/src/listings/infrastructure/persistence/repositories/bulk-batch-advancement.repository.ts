/**
 * Bulk Batch Advancement Repository (#737)
 *
 * TypeORM implementation of `BulkBatchAdvancementRepositoryPort`. Uses an
 * `INSERT ... ON CONFLICT DO NOTHING` query to atomically discover whether
 * a `(bulkBatchId, offerCreationRecordId)` row already exists, in one
 * round-trip, without a transaction.
 *
 * `result.identifiers.length` is the boundary signal: if the insert landed,
 * TypeORM returns the inserted PK; if it was a no-op (row existed),
 * `identifiers` is empty. Both paths return successfully — no exception
 * leaks for the contention case.
 *
 * @module libs/core/src/listings/infrastructure/persistence/repositories
 * @implements {BulkBatchAdvancementRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { BulkBatchAdvancementRepositoryPort } from '../../../domain/ports/bulk-batch-advancement-repository.port';
import { BulkBatchAdvancementOrmEntity } from '../entities/bulk-batch-advancement.orm-entity';

@Injectable()
export class BulkBatchAdvancementRepository implements BulkBatchAdvancementRepositoryPort {
  constructor(
    @InjectRepository(BulkBatchAdvancementOrmEntity)
    private readonly repository: Repository<BulkBatchAdvancementOrmEntity>,
  ) {}

  async markAdvancedIfNotExists(
    bulkBatchId: string,
    offerCreationRecordId: string,
  ): Promise<{ created: boolean }> {
    const result = await this.repository
      .createQueryBuilder()
      .insert()
      .values({ bulkBatchId, offerCreationRecordId })
      .orIgnore()
      .execute();
    return { created: result.identifiers.length > 0 };
  }

  async deleteForRecord(
    bulkBatchId: string,
    offerCreationRecordId: string,
  ): Promise<void> {
    // TypeORM's `.delete({...})` matches by composite key; a non-existent
    // row is a no-op (affected=0). Returns void per the port contract.
    await this.repository.delete({ bulkBatchId, offerCreationRecordId });
  }
}
