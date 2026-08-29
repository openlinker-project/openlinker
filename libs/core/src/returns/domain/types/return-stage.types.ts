/**
 * Return Stage Types (#2377, `W2-40`, returns spec § 3.2)
 *
 * The operator-facing **derived stage** of a return, computed purely from
 * counters and timestamps.
 *
 * ## It is a projection, never a column
 *
 * Spec § 3.2 is explicit: the stage is presentation-only and is **not** a
 * persisted column. If a future wave wants to persist it, that is a model change
 * and needs its own ADR — this file must not become one by the back door. An
 * int-spec asserts no `stage` column exists on `returns` or `return_lines`.
 *
 * ## The array order IS the ordinal
 *
 * First match wins, and the SQL twin's `CASE` is built by iterating this same
 * array (`RETURN_STAGE_PREDICATES` / `RETURN_STAGE_EXPR` in `ReturnRepository`).
 * Reordering therefore CHANGES BEHAVIOUR, which is why
 * `scripts/check-return-stage-mirror.mjs` treats a reorder in either mirror as a
 * hard failure rather than a nit — the same rule `OrderLifecyclePhaseValues`
 * carries (#2311, ADR-059).
 *
 * Spec § 3.2 lists the six in *narrative* order (`Awaiting parcel` first). That
 * is reading order for an operator, **not** precedence, and the two must never
 * both be encoded — one order, one rule. This array is precedence.
 *
 * ## The pure-rule exception applies
 *
 * `deriveReturnStage` lives beside the union under
 * `docs/engineering-standards.md § The pure-rule exception`: it IS the rule for
 * the type it sits with, takes no dependency, performs no I/O, and must be
 * edited in the same commit as the union.
 *
 * @module libs/core/src/returns/domain/types
 * @see docs/specs/product-spec-oms-returns-operator-ux.md § 3.2
 */

/**
 * The six stages, in PRECEDENCE order — first match wins.
 *
 * - `declined` — the SOURCE reported it refused the return.
 * - `not_returned` — every line was written off as never arriving.
 * - `partially_received` — some units arrived, more are still expected.
 * - `received_awaiting_disposition` — everything expected arrived; some of it
 *   has not been restocked or scrapped yet.
 * - `disposed` — everything expected arrived and all of it was disposed of.
 * - `awaiting_parcel` — nothing has arrived yet. The fallback arm.
 */
export const ReturnStageValues = [
  'declined',
  'not_returned',
  'partially_received',
  'received_awaiting_disposition',
  'disposed',
  'awaiting_parcel',
] as const;

export type ReturnStage = (typeof ReturnStageValues)[number];

/** Pure coercion. No default — an unrecognised stage must never become another. */
export function isReturnStage(value: unknown): value is ReturnStage {
  return typeof value === 'string' && (ReturnStageValues as readonly string[]).includes(value);
}

/**
 * The per-return rollup a stage is derived from.
 *
 * Aggregated over the return's lines by the read that needs it — the list
 * projection carries no lines, and loading every line of every row to compute
 * six integers is not what a header-shaped projection is for.
 *
 * `notReturnedQuantityAdvised` exists because of the subtraction below, and
 * `lineCount` / `notReturnedLineCount` because "every line was written off"
 * cannot be expressed by any combination of quantity sums.
 */
export interface ReturnStageCounters {
  lineCount: number;
  notReturnedLineCount: number;
  quantityAdvised: number;
  /** The advised units sitting on lines written off as never arriving. */
  notReturnedQuantityAdvised: number;
  quantityReceived: number;
  quantityRestocked: number;
  quantityScrapped: number;
}

/** The record-level facts a stage also reads. */
export interface ReturnStageFacts {
  /** The SOURCE's own decline instant. Null means "not declined, as far as the channel has said". */
  declinedAt: Date | null;
}

/**
 * Units still expected to arrive: `quantityAdvised` MINUS the units on lines
 * written off as never arriving.
 *
 * **In every arm below, `advised` means *still expected*, not *originally
 * announced*** — and that semantic shift is the rule, not a patch on the
 * arithmetic.
 *
 * `markReturnCustodyNotReturned` refuses a partially-received line, so a
 * `not_returned` line always carries `received = 0` while its `quantityAdvised`
 * would otherwise stay in the denominator forever. Without the subtraction, a
 * two-line return with one line fully received and disposed and the other marked
 * `not_returned` computes `received < advised` and renders **`Partially
 * received` permanently, for a return the operator has finished with** — a false
 * statement about their own completed work. The `not_returned` arm cannot rescue
 * it either, because that arm requires EVERY line to be written off.
 *
 * Stated at length so nobody "fixes" this back to the raw sum.
 */
export function expectedQuantity(counters: ReturnStageCounters): number {
  return counters.quantityAdvised - counters.notReturnedQuantityAdvised;
}

/** Units received but neither restocked nor scrapped. */
export function undisposedQuantity(counters: ReturnStageCounters): number {
  return counters.quantityReceived - (counters.quantityRestocked + counters.quantityScrapped);
}

/**
 * Derive the operator-facing stage. Pure: no I/O, no clock, no mutation.
 *
 * Mirrored by `RETURN_STAGE_PREDICATES` (SQL) and by
 * `apps/web/src/features/returns/lib/return-row.ts` (browser). The mirror script
 * pins the vocabulary and the structure; **this function's semantics are pinned
 * by the shared fixture table**, which both the TS spec and the SQL int-spec
 * consume.
 */
export function deriveReturnStage(
  counters: ReturnStageCounters,
  facts: ReturnStageFacts
): ReturnStage {
  if (facts.declinedAt !== null) {
    return 'declined';
  }

  if (counters.lineCount > 0 && counters.notReturnedLineCount === counters.lineCount) {
    return 'not_returned';
  }

  const expected = expectedQuantity(counters);
  const received = counters.quantityReceived;

  // Outranks `disposed` deliberately: a return with 2 of 5 units arrived and
  // both disposed is NOT finished — three units may still turn up — so calling
  // it `Disposed` would tell the operator the return is closed when it is not.
  // Disposition completeness only means "done" once receipt is complete.
  if (received > 0 && received < expected) {
    return 'partially_received';
  }

  if (received >= expected && undisposedQuantity(counters) > 0) {
    return 'received_awaiting_disposition';
  }

  if (received > 0 && received >= expected) {
    return 'disposed';
  }

  return 'awaiting_parcel';
}
