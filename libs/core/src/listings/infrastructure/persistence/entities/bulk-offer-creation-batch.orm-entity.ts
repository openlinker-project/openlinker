/**
 * Bulk Offer Creation Batch ORM Entity
 *
 * TypeORM entity representing the `bulk_offer_creation_batches` table in
 * PostgreSQL. Parent aggregate for a bulk offer-creation submission.
 *
 * @module libs/core/src/listings/infrastructure/persistence/entities
 * @see {@link BulkOfferCreationBatch} for the corresponding domain entity
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

import { BulkBatchStatus } from '../../../domain/types/bulk-offer-creation-batch.types';

@Entity('bulk_offer_creation_batches')
@Index('IDX_bulk_offer_creation_batches_connectionId', ['connectionId'])
@Index('IDX_bulk_offer_creation_batches_status', ['status'])
export class BulkOfferCreationBatchOrmEntity {
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

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
