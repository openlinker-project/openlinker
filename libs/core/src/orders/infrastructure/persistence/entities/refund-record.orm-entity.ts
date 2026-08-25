/**
 * Refund Record ORM Entity
 *
 * TypeORM-decorated persistence shape for `refund_records` (#2036). Mirrors
 * `InvoiceRecordOrmEntity`'s shape: a plain UUID PK, and a plain indexed
 * `text` column referencing `order_records.internalOrderId` by value only —
 * no FK constraint (avoids cross-table lock coupling; existence is verified
 * at the application layer instead). `amount` is `numeric(12,2)` (not `text`)
 * so a malformed value can never reach the table in the first place — the DB
 * itself enforces the shape the aggregate `SUM()` in
 * `RefundRecordRepository.summarizeByOrderIds` depends on, closing the gap
 * where a barrel-exported `IOrderRefundService.recordRefund` call could
 * bypass the HTTP DTO's regex. The dedup guard mirrors
 * `InvoiceRecordOrmEntity`'s `(connectionId, idempotencyKey)` index, scoped
 * to `internalOrderId` here since refunds have no connection axis.
 *
 * @module infrastructure/persistence/entities
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('refund_records')
@Index('IDX_refund_records_internal_order_id', ['internalOrderId'])
// Retry-safety guard (#2036) — a retried POST with the same idempotencyKey
// against the same order cannot insert a second row. Partial so rows with no
// key (the common case — no natural retry key from a manual operator write)
// don't collide on NULL.
@Index('UQ_refund_records_order_idempotency', ['internalOrderId', 'idempotencyKey'], {
  unique: true,
  where: '"idempotencyKey" IS NOT NULL',
})
// Refunds against one return (#2327). Partial: the overwhelming majority of
// refunds have no return, and indexing those NULLs would be dead weight.
@Index('IDX_refund_records_return_id', ['returnId'], { where: '"returnId" IS NOT NULL' })
export class RefundRecordOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  internalOrderId!: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount!: string;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ type: 'text', nullable: true })
  note: string | null = null;

  @Column({ type: 'timestamptz' })
  recordedAt!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ type: 'text', nullable: true })
  idempotencyKey: string | null = null;

  /**
   * The return this refund settles, when there is one (#2327, ADR-060).
   *
   * **Linked, not extended.** Refunds exist without returns (a goodwill
   * gesture, a price correction) and returns exist without refunds (a warranty
   * swap), so folding return fields onto `RefundRecord` would have widened a
   * shape whose every live row predates returns entirely — falsifying the
   * analytics those rows already feed. A nullable pointer adds a fact without
   * restating any existing one; **no other refund column is touched by #2327**,
   * and the returns int-spec snapshots this table's column list so a later
   * "while we're here" edit fails loudly.
   *
   * No FK to `returns` — the `internalOrderId` precedent directly above (an
   * indexed reference by value, no cross-table lock coupling).
   *
   * **Persistence-only in this slice.** The domain `RefundRecord` entity, its
   * create-input and every read projection are deliberately unchanged: nothing
   * writes or reads this column until Wave 2 wires the return-to-refund link,
   * and projecting a field no writer populates would put a permanently-null
   * property on an API response. Wave 2 adds the domain half.
   */
  @Column({ type: 'text', nullable: true })
  returnId: string | null = null;
}
