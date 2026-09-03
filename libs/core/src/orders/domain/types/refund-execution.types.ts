/**
 * Refund Execution Types (#2371, ADR-056)
 *
 * The neutral command and result of asking a SOURCE to actually move the
 * buyer's money — consumed by the `RefundExecutor` sub-capability of
 * `OrderSourcePort`.
 *
 * These live in `orders` rather than in `returns`, unlike #2333's
 * `ReturnDeclineCommand`, and the split is not arbitrary: a decline is
 * *returns* vocabulary, whereas a refund's vocabulary (`RefundReason`,
 * `RefundExecutedBy`) is owned here, and a refund is not inherently about a
 * return at all — a goodwill refund uses the same shape. Keeping them here also
 * avoids adding a second `orders -> returns` type edge.
 *
 * Domain-only: no framework dependencies.
 *
 * @module domain/types
 * @see docs/architecture/adrs/056-refund-and-fiscal-authority-never-leave-ol.md
 */
import type { RefundReason } from './refund-record.types';

/**
 * What the source is being asked to do.
 */
export interface ExecuteRefundCommand {
  /**
   * The source's own order identifier — **never an OpenLinker internal id**, and
   * `null` where the source never named one.
   *
   * Nullable rather than substituted: an OL internal id in this field would be a
   * value that cannot exist on the platform, so an adapter would query for it
   * and get nothing. `null` says "the source did not tell us", which an adapter
   * can refuse honestly. A return with no source order reference is also, by
   * #2332, one OL could only have attributed through the reconcile — so the
   * marketplace has no order to refund against under its own id.
   */
  externalOrderId: string | null;
  /**
   * The source's own return identifier, where the refund settles a return the
   * source knows about. `null` for a refund with no source-side return (an
   * operator-authored return, or a goodwill refund).
   */
  externalReturnId: string | null;
  /** Decimal string, matching the `RefundRecord.amount` convention. */
  amount: string;
  /** ISO 4217, 3-letter. */
  currency: string;
  reason: RefundReason;
  note: string | null;
  /**
   * **Deterministic, and the caller owns it.**
   *
   * A refund is the least recoverable write in the system, so a retry MUST
   * recompute an identical key — an adapter that mints its own, or a caller
   * that derives one from a clock, turns one retry into two refunds. Core
   * builds it from the return id plus the claimed attempt's identity, which are
   * both stable across a retry of the same logical refund (the #2368/#2370
   * discipline, adapted: there is no per-line `seq` here because a refund is
   * per-RETURN, so the attempt is what supplies identity).
   *
   * An adapter SHOULD forward this to whatever idempotency mechanism its
   * platform offers, and MUST NOT substitute a value of its own.
   */
  idempotencyKey: string;
}

/**
 * What the source said.
 *
 * `outcome` is deliberately three closed values rather than a boolean, because
 * "the platform accepted the request" and "the money has moved" are different
 * facts and collapsing them is how a refund gets reported as complete before it
 * is. See {@link RefundExecutionResult.refundedAt} for the rule that keeps them
 * apart.
 */
export const RefundExecutionOutcomeValues = [
  /** The money has moved, and the source says so. REQUIRES `refundedAt`. */
  'refunded',
  /** The source took the request; settlement is not yet a fact. */
  'accepted',
  /**
   * TERMINAL rejection — the source definitely moved nothing. The only outcome
   * that clears the block and permits another attempt (the ADR-042 discipline,
   * by name).
   */
  'denied',
] as const;

export type RefundExecutionOutcome = (typeof RefundExecutionOutcomeValues)[number];

export interface RefundExecutionResult {
  outcome: RefundExecutionOutcome;
  /** The source's own reference for the refund, where it issues one. */
  providerRefundId: string | null;
  /**
   * **The SOURCE's own instant, or `null`.**
   *
   * An adapter must never substitute its own clock (#2336/#2367): core enters
   * `refunded` only on an OBSERVATION, and the operator surface renders this as
   * *"Confirmed by {source}"*. A fabricated instant would make an OL-authored
   * guess indistinguishable from a marketplace observation — the identical rule
   * `ReturnDeclineResult.declinedAt` carries.
   *
   * A result claiming `outcome: 'refunded'` with no instant is downgraded to
   * `accepted` by core rather than trusted; see `classifyRefundOutcome`.
   */
  refundedAt: Date | null;
  /** The source's own words, verbatim, for the operator to read and quote. */
  providerMessage: string | null;
}
