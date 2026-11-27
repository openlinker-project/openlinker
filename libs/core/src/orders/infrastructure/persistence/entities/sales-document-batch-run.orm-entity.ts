/**
 * Sales-document batch run ORM entities (#3583)
 *
 * `sales_document_batch_runs` and `sales_document_batch_run_items`. Plain
 * `text` status columns with no CHECK, matching `order_exports`: the unions are
 * enforced in TypeScript.
 *
 * `UQ_sales_document_batch_runs_running` is the overlap guard: at most one
 * `running` row per connection, refused by the database rather than by a read.
 * Declared here AND in the migration, because the integration harness builds
 * its schema with `synchronize`.
 *
 * The items' foreign key to the run (`ON DELETE CASCADE`) exists in the
 * migration only, the `return_lines` precedent; the integration harness
 * truncates both tables explicitly.
 *
 * @module libs/core/src/orders/infrastructure/persistence/entities
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('sales_document_batch_runs')
@Index('IDX_sales_document_batch_runs_connection_started', ['connectionId', 'startedAt'])
@Index('UQ_sales_document_batch_runs_running', ['connectionId'], {
  unique: true,
  where: `"status" = 'running'`,
})
export class SalesDocumentBatchRunOrmEntity {
  @PrimaryColumn({ type: 'text' })
  id!: string;

  @Column({ type: 'uuid' })
  connectionId!: string;

  @Column({ type: 'text' })
  trigger!: string;

  @Column({ type: 'jsonb' })
  documentKinds!: string[];

  @Column({ type: 'text' })
  segment!: string;

  @Column({ type: 'timestamptz', nullable: true })
  slotAt!: Date | null;

  @Column({ type: 'text' })
  status!: string;

  @Column({ type: 'text', nullable: true })
  failureReason!: string | null;

  @Column({ type: 'integer', default: 0 })
  eligibleCount!: number;

  @Column({ type: 'integer', default: 0 })
  enqueuedCount!: number;

  @Column({ type: 'integer', default: 0 })
  blockedCount!: number;

  @Column({ type: 'uuid', nullable: true })
  startedByUserId!: string | null;

  @Column({ type: 'timestamptz' })
  startedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt!: Date | null;
}

@Entity('sales_document_batch_run_items')
@Index('IDX_sales_document_batch_run_items_run', ['runId'])
export class SalesDocumentBatchRunItemOrmEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ type: 'text' })
  runId!: string;

  @Column({ type: 'text' })
  orderId!: string;

  @Column({ type: 'text', nullable: true })
  documentKind!: string | null;

  @Column({ type: 'text' })
  result!: string;

  @Column({ type: 'text', nullable: true })
  blockReason!: string | null;

  @Column({ type: 'text', nullable: true })
  idempotencyKey!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
