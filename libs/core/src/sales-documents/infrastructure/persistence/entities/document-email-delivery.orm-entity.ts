/**
 * Document Email Delivery ORM Entity (#3550)
 *
 * No foreign keys: `internalOrderId` and `documentId` are references by value
 * (the `order_changes` / `refund_records` precedent), so a record of what was
 * sent outlives the thing it was about. No PG enum or CHECK on a vocabulary
 * column: the integration harness builds schema by `synchronize`, which would not
 * emit them, so a constraint present only in the migration would hold in
 * production and silently not in tests.
 *
 * @module libs/core/src/sales-documents/infrastructure/persistence/entities
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('document_email_deliveries')
@Index('IDX_document_email_deliveries_order_created', ['internalOrderId', 'createdAt'])
export class DocumentEmailDeliveryOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text', name: 'internalOrderId' })
  internalOrderId!: string;

  @Column({ type: 'varchar', length: 64, name: 'documentKind' })
  documentKind!: string;

  @Column({ type: 'text', name: 'documentId' })
  documentId!: string;

  @Column({ type: 'varchar', length: 16, name: 'sentVia', nullable: true })
  sentVia!: string | null;

  @Column({ type: 'varchar', length: 16, name: 'outcome' })
  outcome!: string;

  @Column({ type: 'varchar', length: 64, name: 'failureReason', nullable: true })
  failureReason!: string | null;

  @Column({ type: 'text', name: 'recipient', nullable: true })
  recipient!: string | null;

  @Column({ type: 'text', name: 'actorUserId', nullable: true })
  actorUserId!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'createdAt' })
  createdAt!: Date;
}
