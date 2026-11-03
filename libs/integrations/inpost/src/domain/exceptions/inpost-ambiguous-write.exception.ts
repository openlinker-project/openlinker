/**
 * InPost Ambiguous Write Exception
 *
 * Raised when a NON-idempotent write (`POST` without an `idempotent: true`
 * opt-in, #3469 — e.g. `generateLabel`'s `POST /v1/organizations/{id}/shipments`)
 * fails with an ambiguous outcome — an ambiguous `5xx` or a network/timeout
 * error — that MAY have already committed server-side. `InpostHttpClient`
 * refuses to auto-retry it internally (#3469), but the failure still
 * propagates out of the job that called it, and `SyncJobRunner` retries any
 * job-level failure by default unless a registered `RetryClassifierPort`
 * says otherwise. Before this, InPost registered NO classifier at all, so
 * every InPost failure — including this one — was retryable by default: the
 * job re-ran and `generateLabel` POSTed again, minting a second paid label
 * for one parcel, the exact duplicate #3469 exists to stop, just moved one
 * layer up.
 *
 * Extends `InpostNetworkException` so it still reads as a transient/network
 * failure to anything pattern-matching on that class; `InpostRetryClassifierAdapter`
 * is what gives it a distinct, non-retryable answer.
 *
 * @module libs/integrations/inpost/src/domain/exceptions
 */
import { InpostNetworkException } from './inpost-network.exception';

export class InpostAmbiguousWriteException extends InpostNetworkException {
  constructor(
    message: string,
    public readonly method: string,
    public readonly path: string,
    public readonly statusCode?: number,
    cause?: unknown,
  ) {
    super(message, cause);
    this.name = 'InpostAmbiguousWriteException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, InpostAmbiguousWriteException);
    }
  }
}
