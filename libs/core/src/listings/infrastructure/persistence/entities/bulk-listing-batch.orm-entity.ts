/**
 * Bulk Offer Creation Batch ORM Entity
 *
 * TypeORM entity representing the `bulk_offer_creation_batches` table in
 * PostgreSQL. Parent aggregate for a bulk offer-creation submission.
 *
 * @module libs/core/src/listings/infrastructure/persistence/entities
 * @see {@link BulkListingBatch} for the corresponding domain entity
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

import { BulkBatchStatus } from '../../../domain/types/bulk-listing-batch.types';

@Entity('bulk_offer_creation_batches')
@Index('IDX_bulk_offer_creation_batches_connectionId', ['connectionId'])
@Index('IDX_bulk_offer_creation_batches_status', ['status'])
// Declared here as well as in the migration, under the same name, because the
// integration harness builds its schema with `synchronize`: without it the
// test database would admit the duplicate batch this index exists to refuse.
@Index(
  'UQ_bulk_offer_creation_batches_connection_idempotency_key',
  ['connectionId', 'idempotencyKey'],
  { unique: true, where: '"idempotencyKey" IS NOT NULL' }
)
export class BulkListingBatchOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  connectionId!: string;

  @Column({ type: 'text' })
  initiatedBy!: string;

  @Column({ type: 'text' })
  status!: BulkBatchStatus;

  @Column({ type: 'integer' })
  totalCount!: number;

  @Column({ type: 'integer', default: 0 })
  succeededCount!: number;

  @Column({ type: 'integer', default: 0 })
  failedCount!: number;

  @Column({ type: 'jsonb' })
  sharedConfig!: Record<string, unknown>;

  @Column({ type: 'text', nullable: true })
  idempotencyKey!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
