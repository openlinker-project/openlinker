/**
 * Invoice Record ORM Entity
 *
 * TypeORM entity for the `invoice_records` table. The `regulatoryStatus` /
 * `clearanceReference` columns are populated by the read-only
 * `RegulatoryStatusReader` reconciliation sub-capability, which reads
 * authoritative provider/CTC status (ADR-002 / ADR-026, #1121); a future
 * `RegulatoryTransmitter` is the separate submit side. The partial-unique index
 * on `(connectionId, idempotencyKey)` is the durable exactly-once issue guard;
 * `IDX_invoice_records_reconcile` is the partial composite index that backs the
 * reconciliation scan (issued + non-terminal, ordered `updatedAt ASC, id ASC`).
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

import { InvoiceStatus, RegulatoryStatus } from '../../../domain/types/invoicing.types';

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
// Reconciliation scan (#1121): issued + non-terminal regulatory status, ordered
// `updatedAt ASC, id ASC`, connection-scoped. Partial so terminal/receipt rows
// (the bulk of the table over time) stay out of the index.
@Index('IDX_invoice_records_reconcile', ['connectionId', 'updatedAt', 'id'], {
  where:
    '"status" = \'issued\' AND "regulatoryStatus" NOT IN (\'accepted\', \'rejected\', \'not-applicable\')',
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

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
