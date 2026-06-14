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
import { Entity, PrimaryColumn, CreateDateColumn } from 'typeorm';

@Entity('bulk_batch_advancements')
export class BulkBatchAdvancementOrmEntity {
  @PrimaryColumn({ type: 'uuid' })
  bulkBatchId!: string;

  @PrimaryColumn({ type: 'uuid' })
  offerCreationRecordId!: string;

  @CreateDateColumn()
  advancedAt!: Date;
}
