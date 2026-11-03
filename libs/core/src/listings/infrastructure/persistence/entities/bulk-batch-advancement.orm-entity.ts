/**
 * Bulk Batch Advancement ORM Entity (#737)
 *
 * TypeORM entity for the `bulk_batch_advancements` table — the at-most-once
 * guard for bulk-listing counter advancement.
 *
 * Composite PK on `(bulkBatchId, offerCreationRecordId)` makes the
 * INSERT-ON-CONFLICT-DO-NOTHING path in `BulkBatchAdvancementRepository`
 * atomic without a transaction.
 *
 * @module libs/core/src/listings/infrastructure/persistence/entities
 * @see {@link BulkBatchAdvancement} for the corresponding domain entity
 */
import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

import type { BulkChildOutcome } from '../../../domain/types/bulk-child-outcome.types';

@Entity('bulk_batch_advancements')
export class BulkBatchAdvancementOrmEntity {
  @PrimaryColumn({ type: 'uuid' })
  bulkBatchId!: string;

  @PrimaryColumn({ type: 'uuid' })
  offerCreationRecordId!: string;

  @CreateDateColumn()
  advancedAt!: Date;

  /**
   * Which counter this advancement incremented. Nullable: rows written before
   * the column existed carry no recorded outcome and are never reclassified.
   */
  @Column({ type: 'varchar', length: 16, nullable: true })
  outcome!: BulkChildOutcome | null;
}
