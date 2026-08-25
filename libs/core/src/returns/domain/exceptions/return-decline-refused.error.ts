/**
 * Return Decline Refusals (#2333, ADR-060)
 *
 * The three ways OL refuses to ask a source to decline a return — deliberately
 * three DISTINCT types rather than one error with a reason string, because the
 * issue's acceptance criteria require an orphan refusal and an
 * unsupported-source refusal to be told apart, and a caller that must parse a
 * message to do so will eventually parse it wrong.
 *
 * All three are **non-retryable**: each reports a state that a retry cannot
 * change. Fixing them is an operator action (attribute the order, use a
 * different connection) or an impossibility (the source has no such write).
 *
 * @module libs/core/src/returns/domain/exceptions
 */

/** No return with that id. */
export class ReturnNotFoundError extends Error {
  constructor(public readonly returnId: string) {
    super(`Return ${returnId} not found`);
    this.name = 'ReturnNotFoundError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ReturnNotFoundError);
    }
  }
}

/**
 * The return is an ORPHAN — OL cannot name the order it belongs to.
 *
 * ADR-060: an unattributed return "blocks every downstream trigger". A decline
 * is such a trigger, and this refusal is additionally structural: an ADR-044
 * change proposal has a NOT NULL `internalOrderId`, so there is no row this
 * action could even record itself as.
 *
 * Raised BEFORE any adapter is resolved — an orphan must cost nothing.
 */
export class ReturnNotAttributedError extends Error {
  constructor(public readonly returnId: string) {
    super(
      `Return ${returnId} is not attributed to an order — an orphan return blocks every downstream trigger`
    );
    this.name = 'ReturnNotAttributedError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ReturnNotAttributedError);
    }
  }
}

/**
 * The return's source connection declares no decline support.
 *
 * Distinct from the orphan case by AC. Covers both "the adapter is not a
 * `ReturnDecliner`" (Erli publishes no rejection endpoint at all) and "no
 * `OrderSource` adapter could be resolved for the connection" — the second is a
 * configuration state an operator can act on, so it carries its own `detail`
 * rather than being silently folded into the first.
 */
export class ReturnDeclineUnsupportedError extends Error {
  constructor(
    public readonly returnId: string,
    public readonly sourceConnectionId: string,
    public readonly detail: string
  ) {
    super(
      `Connection ${sourceConnectionId} cannot decline return ${returnId}: ${detail}`
    );
    this.name = 'ReturnDeclineUnsupportedError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ReturnDeclineUnsupportedError);
    }
  }
}
