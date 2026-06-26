/**
 * Subiekt Bridge Transport Exception (#753)
 *
 * The bridge could not be reached or returned a transport-level failure. Maps
 * from the frozen `SubiektBridgeUnreachableError`.
 *
 * RETRYABILITY — fiscal-safety pivot:
 *   - `'safe'`:          the transport PROVED the request never left the host
 *                        (connect-refused / DNS-failure). Auto-retry cannot
 *                        double-issue a fiscal document. Assigned ONLY for
 *                        `ECONNREFUSED` / `ENOTFOUND` / `EAI_AGAIN`.
 *   - `'indeterminate'`: the POST may have been received and acted on by the
 *                        bridge (timeout, connection-reset, undici errors, 5xx,
 *                        or any unrecognised code). Auto-retry is ONLY safe once
 *                        the bridge guarantees idempotency-key dedup (#752).
 *                        NEVER auto-retry `'indeterminate'` until that
 *                        obligation is verified — doing so risks a double-issued
 *                        fiscal document.
 *
 * `'indeterminate'` is the fiscal-safe DEFAULT: any ambiguity, and any
 * phase-less `SubiektBridgeUnreachableError` (e.g. from the in-memory fake),
 * lands here. `retryable` is a convenience boolean (`=== 'safe'`) for callers
 * that want a single flag.
 *
 * @module libs/integrations/subiekt/src/domain/exceptions
 */

import type { SubiektTransportRetryability } from '../types/subiekt-transport-retryability.types';

export class SubiektBridgeTransportError extends Error {
  readonly retryability: SubiektTransportRetryability;
  readonly retryable: boolean;

  /**
   * Neutral failure discriminator the core `InvoiceService` reads STRUCTURALLY
   * (#1200) to decide fiscal re-attemptability — core never value-imports this
   * class. The transport retryability axis maps 1:1 onto the neutral mode:
   *   - `'safe'`          -> `'rejected'`: the request PROVABLY never left the
   *                          host (connect-refused / DNS-failure), so NO document
   *                          was created — SAFE to re-attempt.
   *   - `'indeterminate'` -> `'in-doubt'`: the POST MAY have been received and
   *                          acted on (timeout / reset / unknown), so a document
   *                          MAY exist — UNSAFE to auto-re-attempt.
   */
  readonly failureMode: 'rejected' | 'in-doubt';

  constructor(
    message: string,
    retryability: SubiektTransportRetryability,
    // Original throwable, preserved for debugging when an unknown error is
    // wrapped into a Subiekt-typed transport error (fiscal-issuance paths lose
    // the most useful stack otherwise).
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'SubiektBridgeTransportError';
    this.retryability = retryability;
    this.retryable = retryability === 'safe';
    this.failureMode = retryability === 'safe' ? 'rejected' : 'in-doubt';
    Error.captureStackTrace(this, this.constructor);
  }
}
