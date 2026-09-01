/**
 * Fulfillment Work Rejection (#2399, `W3a-10`, ADR-054)
 *
 * One holder's refusal of one dispatch attempt, as core reads it back.
 *
 * ## Why refusals accumulate instead of overwriting two columns
 *
 * #2392 deferred "the rejection pair (`rejectionReason`, `blocking`)" to this
 * issue as COLUMNS on the work row. That shape cannot carry the field's own
 * stated purpose. Per `fulfillment-execution.types.ts` property (a), `blocking`
 * exists so re-sourcing can EXCLUDE the rejecter — without it, "re-source plus a
 * deterministic sort re-picks the refuser forever".
 *
 * An exclusion is a **set**: holder A refuses blocking, the router tries B, B
 * refuses too. A scalar pair holds only the LAST refusal, so A's exclusion is
 * silently lost and the loop the field exists to terminate runs anyway — the
 * very defect, re-introduced one level out. So each refusal is its own row.
 *
 * @module libs/core/src/fulfillment/domain/types
 * @see docs/architecture/adrs/054-fulfillment-work-unit-of-assignment.md
 */

export interface FulfillmentWorkRejection {
  readonly id: string;
  readonly fulfillmentWorkId: string;
  /**
   * Denormalised lineage, so the exclusion survives whichever way #2395 decides
   * re-sourcing works. If it mints a NEW work row rather than reusing this one,
   * a `workId`-keyed read returns `[]` and the exclusion is lost; carrying the
   * order id means the broader read is one line of SQL rather than a migration.
   * The read shipped today is still `workId`-keyed — this slice records the
   * lineage without settling a choice it does not own.
   */
  readonly orderId: string;
  /**
   * WHO refused. A rejection that does not say so excludes nobody.
   *
   * Captured at the moment of the refusal rather than read back from
   * `fulfillment_works.assignedConnectionId`, which `clearHolder` may since have
   * moved.
   */
  readonly connectionId: string;
  readonly assignmentAttempt: number;
  /** The rejecter's own vocabulary. Opaque — never parsed or validated here. */
  readonly reason: string;
  /** Whether the rejecter is excluded from re-sourcing. Never optional — see the header. */
  readonly blocking: boolean;
  /** Operator-facing prose from the rejecter, `null` when it offers none. */
  readonly detail: string | null;
  readonly rejectedAt: Date;
}
