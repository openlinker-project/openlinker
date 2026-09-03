/**
 * Return Decline Service Interface (#2333, ADR-060 / ADR-044)
 *
 * The operator action "ask the source to decline this return's refund", in
 * ADR-044's proposed-then-confirmed shape: OL proposes (an `order_changes` row),
 * the source disposes (the adapter write), OL confirms from observation.
 *
 * @module libs/core/src/returns/application/services
 */

/** What an operator asked for. */
export interface DeclineReturnInput {
  returnId: string;
  /** Adapter-native and opaque to core — see `ReturnDeclineCommand`. */
  reasonCode: string;
  comment: string | null;
  /** The OL user who asked; null for a system-initiated decline. */
  requestedBy: string | null;
}

/**
 * How a decline attempt ended.
 *
 * - `declined`      — the source confirmed AND reported the instant; the
 *                     return's `declinedAt` is now stamped.
 * - `decline-sent`  — the source accepted the request but has not yet reported
 *                     the decline as a fact. `declinedAt` stays NULL, because a
 *                     2xx alone must never read as "declined by {source}"
 *                     (returns product spec §5.6 / US-3).
 * - `already-declined` — the return was already declined; nothing was sent.
 * - `in-flight`     — an open proposal within its TTL already holds this
 *                     return's slot, so no second request was made.
 * - `refused`       — the SOURCE refused OL's request; `refusalReason` carries
 *                     its words, and the outcome is persisted on the change row
 *                     rather than swallowed.
 */
export const DeclineReturnOutcomeValues = [
  'declined',
  'decline-sent',
  'already-declined',
  'in-flight',
  'refused',
] as const;

export type DeclineReturnOutcome = (typeof DeclineReturnOutcomeValues)[number];

export interface DeclineReturnResult {
  outcome: DeclineReturnOutcome;
  /** The `order_changes` row this attempt resolved to, when one exists. */
  changeId: string | null;
  /** The SOURCE's own decline instant, or null — never OL's clock. */
  declinedAt: Date | null;
  /** Present only for `refused`. The authority's words, not OL's. */
  refusalReason: string | null;
}

export interface IReturnDeclineService {
  /**
   * Ask the source to decline a return's refund.
   *
   * Refuses, before touching any adapter, when the return is unknown
   * (`ReturnNotFoundError`), is an ORPHAN (`ReturnNotAttributedError` — ADR-060:
   * an unattributed return blocks every downstream trigger), or its source
   * declares no decline support (`ReturnDeclineUnsupportedError` — a DISTINCT
   * reason, by acceptance criterion). All three are non-retryable.
   *
   * Safe to call twice: the ADR-044 proposal row's partial unique index makes a
   * concurrent second call reuse the open proposal (`in-flight`) rather than
   * issue a second remote request, and an already-stamped `declinedAt`
   * short-circuits before the adapter is even resolved (`already-declined`).
   */
  decline(input: DeclineReturnInput): Promise<DeclineReturnResult>;
}
