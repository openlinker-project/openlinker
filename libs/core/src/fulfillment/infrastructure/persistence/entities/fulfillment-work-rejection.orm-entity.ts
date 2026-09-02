/**
 * Fulfillment Work Rejection — ORM entity (#2399, `W3a-10`)
 *
 * One holder's refusal of one dispatch attempt. Append-only: a row is written
 * once by `recordRejection` and never updated, so this table needs no writer
 * table of its own.
 *
 * ## Why this is a TABLE and not two columns on `fulfillment_works`
 *
 * #2392 deferred "the rejection pair (`rejectionReason`, `blocking`)" to this
 * issue as COLUMNS. That would not work, and the reason is the field's own
 * stated purpose. Per `fulfillment-execution.types.ts` property (a), `blocking`
 * exists so re-sourcing can EXCLUDE the rejecter — without it "re-source plus a
 * deterministic sort re-picks the refuser forever".
 *
 * An exclusion is a **set**: holder A refuses blocking, the router tries B, B
 * refuses too. A scalar pair on the work row holds only the LAST refusal, so
 * A's exclusion is silently lost and the infinite loop the field exists to
 * terminate runs anyway — the very defect, re-introduced one level out. So the
 * refusals accumulate.
 *
 * ## `connectionId` is what makes a row mean anything
 *
 * A rejection that does not say WHO refused excludes nobody. It is the holder
 * the work was assigned to at the moment of the refusal — captured explicitly
 * rather than read back from `fulfillment_works.assignedConnectionId`, which
 * `clearHolder` may since have moved.
 *
 * ## `orderId` is denormalised, and that is a deliberate refusal to bind #2395
 *
 * The repository's writer table says re-routing may mint a NEW work row
 * (`locationId` / `deliveryMethod` are insert-only precisely to force #2395 to
 * choose). If it does, a `workId`-keyed exclusion read returns `[]` and the
 * exclusion is lost. This slice does not own that choice and must not settle it
 * silently, so it keeps the LINEAGE instead: carrying `orderId` means the
 * broader read is available to #2395 as one line of SQL rather than a migration,
 * whichever way it decides. The read shipped today is `workId`-keyed.
 *
 * **Constraint recorded against #2395**: if re-sourcing mints a new work row, it
 * must carry the blocking exclusions forward.
 *
 * ## Indexes
 *
 * - `UQ_…_work_attempt` — one recorded answer per attempt. A real invariant; the
 *   reject stamp's transaction guard only enforces it incidentally, and an
 *   incidental invariant is one a later caller breaks.
 * - `IDX_…_blocking` — the exclusion read, partial because non-blocking rows are
 *   exactly the set it can never match.
 * - No separate `(fulfillmentWorkId)` index is needed: the UNIQUE index above is
 *   unconditional and its leading column serves both every
 *   `WHERE "fulfillmentWorkId" = ?` lookup and the FK's referential check — the
 *   `fulfillment_work_lines` situation, not the `fulfillment_holds` one (whose
 *   only other index is partial and therefore cannot serve the CASCADE).
 *
 * The FK to `fulfillment_works(id) ON DELETE CASCADE` is declared in the
 * **migration only**, with no `@ManyToOne` — the `fulfillment_work_lines` /
 * `fulfillment_holds` precedent in this same slice.
 *
 * @module libs/core/src/fulfillment/infrastructure/persistence/entities
 * @see docs/architecture/adrs/054-fulfillment-work-unit-of-assignment.md
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('fulfillment_work_rejections')
@Index('UQ_fulfillment_work_rejections_work_attempt', ['fulfillmentWorkId', 'assignmentAttempt'], {
  unique: true,
})
@Index('IDX_fulfillment_work_rejections_blocking', ['fulfillmentWorkId', 'connectionId'], {
  where: '"blocking" = true',
})
export class FulfillmentWorkRejectionOrmEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_fulfillment_work_rejections',
  })
  id!: string;

  @Column({ type: 'text' })
  fulfillmentWorkId!: string;

  /** Denormalised lineage — see the header. */
  @Column({ type: 'text' })
  orderId!: string;

  /** The holder that refused. Without it the row excludes nobody. */
  @Column({ type: 'uuid' })
  connectionId!: string;

  @Column({ type: 'integer' })
  assignmentAttempt!: number;

  /** The rejecter's own vocabulary. Opaque — never parsed or validated here. */
  @Column({ type: 'text' })
  reason!: string;

  /**
   * NOT NULL by design. `fulfillment-execution.types.ts` types it non-optional
   * because `blocking?: boolean` reads `undefined`, which is falsy, so the
   * rejecter would NOT be excluded and the loop the field prevents would run
   * anyway. The column refuses a row that lost the value in transit.
   */
  @Column({ type: 'boolean' })
  blocking!: boolean;

  /** Operator-facing prose from the rejecter, `null` when it offers none. */
  @Column({ type: 'text', nullable: true })
  detail!: string | null;

  @Column({ type: 'timestamptz' })
  rejectedAt!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
