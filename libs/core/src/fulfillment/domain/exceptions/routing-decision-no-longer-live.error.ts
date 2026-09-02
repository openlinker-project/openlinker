/**
 * Routing Decision No Longer Live (#2395, `W3a-6`)
 *
 * Raised inside the one-transaction commit when the decision being committed has
 * stopped being `live` — a peer terminalised it while this caller was creating
 * work rows. Throwing is what rolls those rows back (ADR-054 R1).
 *
 * ## Why this is NOT `RoutingDecisionAlreadyLiveError`
 *
 * That error asserts the OPPOSITE condition — "a live decision already exists" —
 * and `RoutingCommitService.claimOrResume` pattern-matches on it to mean exactly
 * that, resuming the winner. Reusing it here would be a name that contradicts
 * its own condition, and the next person to wrap `route()` in a `catch` would
 * get a RESUME where a rollback happened. Distinct condition, distinct type.
 *
 * @module libs/core/src/fulfillment/domain/exceptions
 */
export class RoutingDecisionNoLongerLiveError extends Error {
  constructor(
    public readonly orderId: string,
    public readonly decisionId: string
  ) {
    super(
      `Routing decision ${decisionId} for order ${orderId} is no longer live; ` +
        `rolling back the work rows created against it.`
    );
    this.name = 'RoutingDecisionNoLongerLiveError';
    Error.captureStackTrace?.(this, this.constructor);
  }
}
