/**
 * Return Decline Unsupported Error (#2333, ADR-060)
 *
 * The refusal that is SPECIFIC to the decline write. The other two ways a
 * decline is refused — "no such return" and "the return is an orphan" — are not
 * specific to it at all: they are the vocabulary EVERY downstream trigger is
 * refused by, so they live with the trigger guard as `ReturnNotFoundError`
 * (`./return-not-found.error`) and `ReturnNotAttributedError`
 * (`./return-not-attributed.error`), one class per file (#2332) — the convention this
 * file was renamed to follow when the two slices were reconciled.
 *
 * **Why that matters, recorded here so it is not re-split.** #2332 and #2333 were
 * built concurrently and each defined its own `ReturnNotFoundError` and
 * `ReturnNotAttributedError`. Two same-named classes are not a cosmetic
 * duplication: `instanceof` silently returns `false` across them, so the HTTP
 * filter would answer 500 for a refusal the service raised deliberately, and a
 * Wave-2 trigger catching one would sail straight past the other. There is now
 * exactly one definition of each, and `ReturnDeclineService` asserts attribution
 * through `IReturnsService.assertAttributedForTrigger('decline')` rather than
 * spelling its own `internalOrderId === null` check.
 *
 * This one is **non-retryable**: it reports a state a retry cannot change.
 * Fixing it is an operator action (use a different connection) or an
 * impossibility (the source has no such write).
 *
 * @module libs/core/src/returns/domain/exceptions
 */

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
