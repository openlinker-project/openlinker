/**
 * Return Custody Contended Error
 *
 * Raised when the per-line custody lock is already held (#2370).
 *
 * **Retryable, and it never reaches the adapter.** The dispose path validates
 * the counters and then crosses a provider boundary that moves real stock, so it
 * is read-then-act and must be serialized — the same shape ADR-041 §3a
 * serializes with `invoiceIssueLockKey`, for the same reason: two attempts both
 * pass the check, both call the master, and the goods are counted twice.
 *
 * A contended caller learns it lost rather than proceeding, which is the whole
 * point; the loser has moved nothing and is safe to retry.
 *
 * @module domain/exceptions
 */
export class ReturnCustodyContendedError extends Error {
  constructor(public readonly lineId: string) {
    super(
      `Another custody write is in progress for return line ${lineId}; ` +
        'nothing was changed — retry'
    );
    this.name = 'ReturnCustodyContendedError';
    Error.captureStackTrace(this, this.constructor);
  }
}
