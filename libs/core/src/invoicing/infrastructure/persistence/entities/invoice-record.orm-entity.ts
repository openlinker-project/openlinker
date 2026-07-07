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

import type {
  InvoiceFailureCode,
  InvoiceFailureMode,
  IssuedDocumentContent,
  IssuedLineSnapshot,
  StoredDocument,
} from '../../../domain/types/invoicing.types';
import { InvoiceStatus, PaymentStatus, RegulatoryStatus } from '../../../domain/types/invoicing.types';

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

  /**
   * Neutral payment lifecycle (#1354) — refreshed from an authoritative
   * `PaymentStatusReader` read triggered by a provider payment webhook. Defaults
   * `unknown` (never asserts "unpaid" for a document OL has not polled).
   */
  @Column({ type: 'text', default: 'unknown' })
  paymentStatus!: PaymentStatus;

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
   * Neutral machine-readable failure code (W1) — `null` unless `status =
   * 'failed'`. The closed {@link InvoiceFailureCode} taxonomy the FE switches on
   * (never the PII-tainted `errorMessage`).
   */
  @Column({ type: 'varchar', nullable: true })
  failureCode!: InvoiceFailureCode | null;

  /**
   * Short, PII-free failure summary (W1) — `null` unless `status = 'failed'`.
   * Safe to expose, unlike the INTERNAL-ONLY `errorMessage`.
   */
  @Column({ type: 'text', nullable: true })
  failureReason!: string | null;

  /**
   * Lease expiry for the `issuing` CAS claim (#1200) — `null` unless this row
   * currently holds the in-flight slot. Backs the atomic `claimForIssue` guard
   * that lets exactly one concurrent same-key retry cross the provider boundary.
   */
  @Column({ type: 'timestamp', nullable: true })
  leaseExpiresAt!: Date | null;

  /**
   * Neutral denormalized flag: did the buyer carry a tax identifier at issue
   * time (#1202)? Backs the `taxId=with|without` list filter without joining to
   * the Order. Not "nip" — a presence boolean. Defaults `false` for legacy rows.
   */
  @Column({ type: 'boolean', default: false })
  hasBuyerTaxId!: boolean;

  /**
   * Neutral issued-document content snapshot (§7.3), captured at issue time.
   * `null` until a document is issued (or when the adapter surfaces no content).
   */
  @Column({ type: 'jsonb', nullable: true })
  documentContent!: IssuedDocumentContent | null;

  /**
   * Neutral persisted source document (PL/KSeF: the FA(3) XML) — provider MIME +
   * base64 bytes — captured at issue time so `GET .../document?kind=source`
   * re-serves it without a provider round-trip. `null` until issued (or when the
   * adapter surfaces no source document).
   */
  @Column({ type: 'jsonb', nullable: true })
  sourceDocument!: StoredDocument | null;

  /**
   * Neutral issuance-time line snapshot (#1297) — `{ buyer, currency, lines }`
   * as issued, so a later correction diffs its deltas against the issued lines
   * rather than the order's current state. `null` for pre-migration rows.
   */
  @Column({ type: 'jsonb', nullable: true })
  issuedLineSnapshot!: IssuedLineSnapshot | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
