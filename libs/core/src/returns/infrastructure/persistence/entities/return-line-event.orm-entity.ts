/**
 * Return Line Event ORM Entity
 *
 * TypeORM entity for the `return_line_events` table (#2370, ADR-060) — the
 * append-only act ledger beside `return_lines`' counters.
 *
 * **The PK is a plain uuid**, matching `return_lines`: an act is never
 * referenced from outside its aggregate and has no external counterpart to map,
 * so minting an `ol_*` internal id would buy nothing.
 *
 * **No foreign key to `return_lines`**, matching this context's existing
 * posture (the one FK in the returns schema is `return_lines.returnId ->
 * returns(id) ON DELETE CASCADE`; `refund_records` / `invoice_records` set the
 * precedent of an indexed reference by value). The consequence is that
 * `truncateTables`' CASCADE walk cannot reach this table from `return_lines`, so
 * it is listed EXPLICITLY in the integration harness — see
 * `apps/api/test/integration/setup.ts`.
 *
 * **Every index and check is declared here under the SAME NAME the migration
 * uses.** The integration harness builds its schema by `synchronize`, not by
 * migration (`returns-schema.int-spec.ts` states this outright), so a constraint
 * present only in the migration would hold in production and silently NOT in
 * tests — the `return_lines` / `offer_commercial_snapshots` precedent.
 *
 * @module libs/core/src/returns/infrastructure/persistence/entities
 */
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('return_line_events')
// The per-line sequence IS the `{seq}` of the `return:{returnId}:{lineId}:{seq}`
// idempotency key (#2368). Unique so two concurrent writers cannot mint the same
// key for two different acts — the loser's insert fails rather than both calling
// the master under one key. Also serves every `WHERE returnLineId = ?` read as
// its leading column, so no second index on that column is warranted.
@Index('UQ_return_line_events_line_seq', ['returnLineId', 'seq'], { unique: true })
// The operator-attention read: "does this return still hold an unresolved
// restock block?" Partial, because the rows it can never match are the
// overwhelming majority — every receipt, every scrap, every applied restock.
// Spec § 5.4 requires the list segment to count UNHANDLED blocks only, which is
// exactly this predicate.
@Index('IDX_return_line_events_outstanding_restock', ['returnId'], {
  where: `"restockState" IN ('blocked', 'in_doubt')`,
})
// An act is about a positive whole number of units. Zero or negative would make
// the counters derived from these rows meaningless, and a correction is modelled
// as its own act rather than as a negative one.
@Check('CHK_return_line_events_quantity_positive', '"quantity" > 0')
export class ReturnLineEventOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * Denormalised from the line so the outstanding-block read is one indexed
   * lookup per RETURN rather than a fan-out over its lines. The line already
   * carries `returnId`, so this cannot disagree with it in any write this
   * context performs.
   */
  @Column({ type: 'text' })
  returnId!: string;

  @Column({ type: 'text' })
  returnLineId!: string;

  @Column({ type: 'integer' })
  seq!: number;

  /** `receive | dispose | stock_attestation`, stored as text per house rule. */
  @Column({ type: 'varchar', length: 32 })
  kind!: string;

  @Column({ type: 'integer' })
  quantity!: number;

  /** Only ever set on a `dispose` act. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  disposition!: string | null;

  /**
   * What became of the master stock write. Defaults to `not_applicable` — the
   * correct value for a receipt and for a scrap, which are the majority.
   */
  @Column({ type: 'varchar', length: 32, default: 'not_applicable' })
  restockState!: string;

  @Column({ type: 'varchar', length: 48, nullable: true })
  restockBlockedReason!: string | null;

  /**
   * The adapter's own sentence, verbatim (#2231's rule). `text` rather than a
   * bounded varchar because it carries a third party's message and truncating
   * an operator's only actionable clue to fit a column is not a trade worth
   * making.
   */
  @Column({ type: 'text', nullable: true })
  restockBlockedDetail!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  restockedBy!: string | null;

  /**
   * The inventory master this attempt was made against. Nullable: a refusal can
   * happen before any connection is chosen (none configured, or several claimed
   * the role). No FK — the `refund_records` precedent of an indexed reference by
   * value; a deleted connection must not delete the record of what it refused.
   */
  @Column({ type: 'text', nullable: true })
  masterConnectionId!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  /** Nullable so a future non-interactive writer is expressible. */
  @Column({ type: 'text', nullable: true })
  actorUserId!: string | null;

  /**
   * When the operator did this. OL's clock IS authoritative — every act in this
   * ledger happens inside OpenLinker with the operator as the sensor, which is
   * the other side of #2367's rule that `in_transit` must take the SOURCE's
   * instant because OL cannot witness it.
   */
  @Column({ type: 'timestamptz' })
  occurredAt!: Date;

  /** Set only on a `stock_attestation`: the blocked/in-doubt act it resolves. */
  @Column({ type: 'uuid', nullable: true })
  attestedByEventId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
