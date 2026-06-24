/**
 * Invoice Record ORM Entity
 *
 * TypeORM entity for the `invoice_records` table. The `regulatoryStatus` /
 * `clearanceReference` columns are nullable and unused until a future
 * `RegulatoryTransmitter` adapter populates them (ADR-026) — carried now so
 * adding transmission needs no migration. The partial-unique index on
 * `(connectionId, idempotencyKey)` is the durable exactly-once issue guard.
 *
 * @module libs/core/src/invoicing/infrastructure/persistence/entities
 * @see {@link InvoiceRecord} for the corresponding domain entity
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import {
  InvoiceFailureMode,
  InvoiceStatus,
  RegulatoryStatus,
} from '../../../domain/types/invoicing.types';

@Entity('invoice_records')
@Index('IDX_invoice_records_order_connection', ['orderId', 'connectionId'])
@Index('IDX_invoice_records_connectionId', ['connectionId'])
@Index('IDX_invoice_records_status', ['status'])
// Lookup of an issued document by provider id (transmission/reconcile paths).
@Index('IDX_invoice_records_provider_invoice_id', ['providerInvoiceId'], {
  where: '"providerInvoiceId" IS NOT NULL',
})
// Fiscal-dedup guard — exactly-once issuance on retry (ADR-026). Partial so
// rows without a key (manual one-off issues) don't collide on NULL.
@Index('UQ_invoice_records_connection_idempotency', ['connectionId', 'idempotencyKey'], {
  unique: true,
  where: '"idempotencyKey" IS NOT NULL',
})
export class InvoiceRecordOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  connectionId!: string;

  @Column({ type: 'text' })
  orderId!: string;

  @Column({ type: 'text' })
  providerType!: string;

  /** Neutral document type; well-known values in `DocumentTypeValues` (open-world). */
  @Column({ type: 'text' })
  documentType!: string;

  @Column({ type: 'text' })
  status!: InvoiceStatus;

  @Column({ type: 'text', nullable: true })
  providerInvoiceId!: string | null;

  @Column({ type: 'text', nullable: true })
  providerInvoiceNumber!: string | null;

  @Column({ type: 'text', default: 'not-applicable' })
  regulatoryStatus!: RegulatoryStatus;

  @Column({ type: 'text', nullable: true })
  clearanceReference!: string | null;

  @Column({ type: 'text', nullable: true })
  idempotencyKey!: string | null;

  @Column({ type: 'text', nullable: true })
  pdfUrl!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  issuedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  errorMessage!: string | null;

  /**
   * Neutral failure discriminator (#1200) — `null` unless `status = 'failed'`.
   * `rejected` (terminal, no document) is re-attemptable; `in-doubt` is not.
   */
  @Column({ type: 'text', nullable: true })
  failureMode!: InvoiceFailureMode | null;

  /**
   * Lease expiry for the `issuing` CAS claim (#1200) — `null` unless this row
   * currently holds the in-flight slot. Backs the atomic `claimForIssue` guard
   * that lets exactly one concurrent same-key retry cross the provider boundary.
   */
  @Column({ type: 'timestamp', nullable: true })
  leaseExpiresAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
