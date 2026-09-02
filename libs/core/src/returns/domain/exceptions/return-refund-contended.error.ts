/**
 * Return Refund Contended Error
 *
 * Raised when the per-RETURN refund lock is already held (#2371).
 *
 * **Retryable, and it never reaches the executor.** Unlike its custody sibling
 * the lock here is NOT the correctness guarantee — the conditional claim in
 * `ReturnRepositoryPort.claimRefundAttempt` is, and it survives a lock that
 * expired mid-provider-call. The lock exists so a contended second attempt is
 * refused with an answer an operator can act on, rather than racing to a
 * zero-row claim it would then have to interpret as a refusal.
 *
 * Keyed per RETURN rather than per line for the reason `invoiceIssueLockKey` is
 * keyed per order (#2047): a refund is one amount against one order, so two
 * operators refunding two different lines of the same return is exactly the case
 * a narrower key would let through.
 *
 * @module domain/exceptions
 */
export class ReturnRefundContendedError extends Error {
  constructor(public readonly returnId: string) {
    super(
      `Another refund attempt is in progress for return ${returnId}; ` +
        'nothing was changed — retry'
    );
    this.name = 'ReturnRefundContendedError';
    Error.captureStackTrace(this, this.constructor);
  }
}
