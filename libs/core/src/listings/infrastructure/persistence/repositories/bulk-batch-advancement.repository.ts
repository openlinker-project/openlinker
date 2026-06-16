/**
 * Bulk Batch Advancement Repository (#737)
 *
 * TypeORM implementation of `BulkBatchAdvancementRepositoryPort`. Uses an
 * `INSERT ... ON CONFLICT DO NOTHING` query to atomically discover whether
 * a `(bulkBatchId, offerCreationRecordId)` row already exists, in one
 * round-trip, without a transaction.
 *
 * The **RETURNING rows** (`result.raw`) are the boundary signal: Postgres
 * `INSERT … ON CONFLICT DO NOTHING RETURNING …` yields the inserted row on a
 * fresh insert and **0 rows on conflict**, so `result.raw.length > 0` ⇔ the row
 * was newly created. (`result.identifiers` is NOT usable here — TypeORM echoes
 * the *input* PK for a non-generated composite `@PrimaryColumn`, so it is always
 * non-empty regardless of the conflict outcome; #1084.) Mirrors the proven
 * `webhook-delivery.repository.ts:insertIfNew` gate (#711). Both paths return
 * successfully — no exception leaks for the contention case.
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
    // RETURNING rows, not `identifiers` (#1084): empty ⇒ ON CONFLICT skipped the
    // insert (row already existed) ⇒ not newly created. `Array.isArray` guards
    // the (here-unreachable) empty-valueSet path where TypeORM leaves `raw`
    // undefined, matching the webhook-delivery gate's defensiveness.
    return { created: Array.isArray(result.raw) && result.raw.length > 0 };
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
