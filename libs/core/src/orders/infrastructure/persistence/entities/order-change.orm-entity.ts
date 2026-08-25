/**
 * Order Change ORM Entity (#2333, ADR-044)
 *
 * TypeORM entity for the `order_changes` table — the ADR-044 change-proposal
 * record, and the table Wave 2 (#2389) reuses rather than re-inventing.
 *
 * **`kind` names the verb OL asked for; `status` names what happened to the
 * asking.** See `order-change.types.ts` for the full rule.
 *
 * **`kind` is a plain `varchar`, with no PG enum and no `CHECK`.** Wave 2 widens
 * the vocabulary; a database-level list would cost a migration per kind and
 * would turn an out-of-tree kind into a hard write failure rather than a
 * coercion miss. `isOrderChangeKind` coerces on read.
 *
 * `internalOrderId` carries **no FK** to `order_records` — the `refund_records` /
 * `invoice_records` precedent of an indexed reference by value, avoiding
 * cross-table lock coupling. `setup.ts` therefore lists `order_changes` in
 * `tablesToTruncate` explicitly: nothing cascades into it.
 *
 * Every index is declared at class level with the SAME NAME the migration uses.
 * The integration harness builds its schema by `synchronize`, not by migration,
 * so an unnamed decorator would produce a hash name there and the two schemas
 * would diverge on exactly the constraint an int-spec asserts (#2327's rule).
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

@Entity('order_changes')
// R2 — the grain is (order, target), and only an OPEN row holds the slot. The
// predicate must stay identical to `OPEN_ORDER_CHANGE_STATUSES`.
@Index('UQ_order_changes_open_target', ['internalOrderId', 'targetRef'], {
  unique: true,
  where: `"status" IN ('pending', 'requested')`,
})
@Index('IDX_order_changes_order', ['internalOrderId', 'createdAt'])
@Index('IDX_order_changes_target', ['targetRef'])
export class OrderChangeOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** NOT NULL by design — see the domain entity's docblock. */
  @Column({ type: 'text' })
  internalOrderId!: string;

  @Column({ type: 'varchar', length: 64 })
  kind!: string;

  @Column({ type: 'text' })
  targetRef!: string;

  @Column({ type: 'varchar', length: 16 })
  status!: string;

  /**
   * Kind-specific request data. Carries **no buyer data**: for `return.decline`
   * it is an operator-chosen reason code and operator free text. The named PII
   * gap on `returns.rawPayload` does not transfer here.
   */
  @Column({ type: 'jsonb', nullable: true })
  payload!: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  requestedBy!: string | null;

  @Column({ type: 'timestamptz' })
  requestedAt!: Date;

  @Column({ type: 'text', nullable: true })
  confirmedBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  confirmedAt!: Date | null;

  /** Why the AUTHORITY refused OL's request. Never why OL asked, never a timeout. */
  @Column({ type: 'text', nullable: true })
  declinedReason!: string | null;

  /** R5 — guards APPLICATION of a confirmed change, claimed `WHERE IS NULL`. */
  @Column({ type: 'timestamptz', nullable: true })
  appliedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
