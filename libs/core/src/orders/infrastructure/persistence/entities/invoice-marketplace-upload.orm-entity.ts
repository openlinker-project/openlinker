/**
 * Invoice Marketplace Upload ORM Entity
 *
 * TypeORM entity for `invoice_marketplace_uploads` (#3549): whether an issued
 * sales document reached the marketplace order it was issued for, one row per
 * `(invoiceRecordId, targetConnectionId)`. The unique index is the at-most-once
 * claim, not a convenience.
 *
 * No foreign keys, the `order_changes` / `refund_records` precedent: both ids are
 * cross-aggregate references by value, and the upload history must outlive a
 * deleted connection rather than cascade away with it.
 *
 * @module libs/core/src/orders/infrastructure/persistence/entities
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('invoice_marketplace_uploads')
@Index(
  'UQ_invoice_marketplace_uploads_invoice_target',
  ['invoiceRecordId', 'targetConnectionId'],
  { unique: true },
)
export class InvoiceMarketplaceUploadOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  invoiceRecordId!: string;

  @Column({ type: 'uuid' })
  targetConnectionId!: string;

  @Column({ type: 'text' })
  status!: string;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  /** A stable code, never a provider message (see the domain type). */
  @Column({ type: 'text', nullable: true })
  lastFailureCode!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  uploadedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
