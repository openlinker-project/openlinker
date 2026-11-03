/**
 * KSeF Rate-Limit Deferred Exception (DEF-04)
 *
 * Thrown BEFORE a session opens when the connection's KSeF budget for the
 * rolling hour would not free up within the wait OpenLinker allows inside one
 * issuance. Waiting longer would stretch the provider round-trip past the
 * fiscal issuing lease, after which a second attempt can claim the same order
 * and submit it twice.
 *
 * `failureMode: 'rejected'` because nothing reached KSeF, and `retryAfterMs`
 * lets the retry classifier requeue the job without spending an attempt: the
 * job did nothing wrong, the budget is simply in use.
 *
 * @module libs/integrations/ksef/src/domain/exceptions
 */
export class KsefRateLimitDeferredException extends Error {
  readonly failureMode = 'rejected' as const;

  constructor(
    readonly bucketKey: string,
    readonly retryAfterMs: number,
  ) {
    super(
      `KSeF rate-limit budget for this seller is in use; the next session slot frees in ` +
        `${Math.ceil(retryAfterMs / 1000)}s. Deferred before opening a session.`,
    );
    this.name = 'KsefRateLimitDeferredException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, KsefRateLimitDeferredException);
    }
  }
}
