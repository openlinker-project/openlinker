/**
 * Return Restock Already Blocked Error
 *
 * Raised when `disposeLine` is asked to restock a line that already has an
 * outstanding (`blocked` or `in_doubt`) restock event (#3466).
 *
 * **Why refuse rather than allow it.** `outstandingToDispose` deliberately
 * never decreases after a blocked write (`quantityRestocked` is only bumped by
 * a CONFIRMED master write, #2370), so a blocked line's "still outstanding"
 * quantity is unchanged after the attempt that just failed. Nothing stopped an
 * operator resubmitting the same dispose over and over — each submission mints
 * a fresh event under a fresh idempotency-key `seq` (#2368), so the master-side
 * dedup cannot catch it (it is a genuinely new attempt, not a retry), and the
 * restock-blocked banner sums `quantity` across every outstanding event for the
 * line — so the remedy quantity it shows grows without bound on every click.
 *
 * The fix is not to roll back or edit the disposition — that would contradict
 * the append-only act ledger (ADR-060: *"the ACT is the disposition and is
 * never rolled back"*) — it is to stop the duplicate act from being created at
 * all. `markStockHandledManually` remains the only way to clear a block.
 *
 * @module domain/exceptions
 */
export class ReturnRestockAlreadyBlockedError extends Error {
  /** The closed reason code this error carries onto the HTTP boundary (#2376's convention). */
  public readonly reason = 'restock-already-blocked' as const;

  constructor(public readonly lineId: string) {
    super(
      `Return line ${lineId} already has an outstanding blocked restock; ` +
        'mark it handled before disposing more — nothing was changed'
    );
    this.name = 'ReturnRestockAlreadyBlockedError';
    Error.captureStackTrace(this, this.constructor);
  }
}
