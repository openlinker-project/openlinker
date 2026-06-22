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

export type SubiektTransportRetryability = 'safe' | 'indeterminate';

export class SubiektBridgeTransportError extends Error {
  readonly retryability: SubiektTransportRetryability;
  readonly retryable: boolean;

  constructor(message: string, retryability: SubiektTransportRetryability) {
    super(message);
    this.name = 'SubiektBridgeTransportError';
    this.retryability = retryability;
    this.retryable = retryability === 'safe';
    Error.captureStackTrace(this, this.constructor);
  }
}
