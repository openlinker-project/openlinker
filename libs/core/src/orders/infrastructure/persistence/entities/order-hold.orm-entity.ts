/**
 * Order Hold ORM Entity (#2338, DESIGN §6.3)
 *
 * TypeORM entity for `order_holds` — the record that OpenLinker deliberately
 * stopped an order.
 *
 * **`reason` is a plain `varchar`, with no PG enum and no `CHECK`.** Unlike
 * `order_changes.kind` (open by design, widened by Wave 2), `HoldReason` is a
 * CLOSED union (ADR-059), so a database-level list would be defensible — it is
 * still declined, because it would cost a migration per value and would turn a
 * rollback past a widened vocabulary into a hard write failure rather than a
 * coercion miss. `isHoldReason` coerces on read and
 * `OrderHoldVocabularyError` reports a miss; a later reader should not "fix" the
 * omission by adding a `CHECK`.
 *
 * `internalOrderId` carries **no FK** to `order_records` — the `refund_records` /
 * `invoice_records` / `order_changes` precedent of an indexed reference by
 * value, avoiding cross-table lock coupling. `setup.ts` therefore lists
 * `order_holds` in `tablesToTruncate` explicitly: nothing cascades into it.
 *
 * Every index and constraint is declared at class level with the SAME NAME the
 * migration uses. The integration harness builds its schema by `synchronize`,
 * not by migration, so an unnamed decorator would produce a hash name there and
 * the two schemas would diverge on exactly the constraint an int-spec asserts
 * (#2327's rule; `ReturnLineOrmEntity`'s `@Check` is the precedent).
 *
 * @module libs/core/src/orders/infrastructure/persistence/entities
 */
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('order_holds')
// R1 — at most one OPEN hold per order. PARTIAL, so releasing frees the slot;
// the predicate must stay identical to `OrderHold.isOpen()`.
@Index('UQ_order_holds_open_order', ['internalOrderId'], {
  unique: true,
  where: `"releasedAt" IS NULL`,
})
@Index('IDX_order_holds_order', ['internalOrderId', 'placedAt'])
// T3's read (`listOpenPlacedBefore`) scans open rows only.
@Index('IDX_order_holds_open_placed_at', ['placedAt'], {
  where: `"releasedAt" IS NULL`,
})
// R2 — exactly one actor. `<>` (XOR), not "at least one": a row claiming both a
// human and a service placed it is an unanswerable audit question, and §6.4's
// release rule is only decidable if the placer is unambiguous.
@Check(
  'CHK_order_holds_actor',
  '("placedByUserId" IS NOT NULL) <> ("placedByService" IS NOT NULL)'
)
export class OrderHoldOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** NOT NULL by design — see the domain entity's docblock. */
  @Column({ type: 'text' })
  internalOrderId!: string;

  /** A `HoldReason`. Coerced on read; see this file's docblock for why no CHECK. */
  @Column({ type: 'varchar', length: 64 })
  reason!: string;

  /** Operator free text. Never buyer data. */
  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ type: 'text', nullable: true })
  placedByUserId!: string | null;

  @Column({ type: 'text', nullable: true })
  placedByService!: string | null;

  /**
   * Caller-supplied, not a DB default, so the service owns the clock and a test
   * can pin it. The backing fact for automation trigger T3 — there is
   * deliberately no `phaseEnteredAt` column anywhere.
   */
  @Column({ type: 'timestamptz' })
  placedAt!: Date;

  /**
   * The state, not merely an audit field: null means open. Claimed by a narrow
   * conditional UPDATE (`WHERE "releasedAt" IS NULL`), the `waybillRelayedAt` /
   * `cancelledAt` / `fxStampedAt` shape.
   */
  @Column({ type: 'timestamptz', nullable: true })
  releasedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  releasedByUserId!: string | null;

  /**
   * Nullable here by design. §6.4 makes it mandatory when an admin releases a
   * SERVICE-placed hold, which is a policy about who is releasing — something
   * the schema cannot know. #2339's service enforces it.
   */
  @Column({ type: 'text', nullable: true })
  releaseNote!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
