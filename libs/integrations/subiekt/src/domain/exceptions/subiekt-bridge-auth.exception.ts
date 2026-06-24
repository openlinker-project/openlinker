/**
 * Subiekt Bridge Auth Exception (#753) — TERMINAL
 *
 * Thrown when the bridge rejects the request with a 401 / 403. This is a BRIDGE
 * AUTH / CONFIG problem (bad / missing bridge token or credentials), NOT a
 * fiscal rejection of the invoice — so it must NOT be surfaced as a
 * `SubiektInvoiceRejectedError`. Operator-readable; never carries the token.
 *
 * Fiscal-safety: TERMINAL / non-retryable. A retry with the same (bad) cred
 * would fail identically, and re-issuing on a credential fix is a human action,
 * not an auto-retry. `SubiektRetryClassifierAdapter` classifies it non-retryable.
 *
 * @module libs/integrations/subiekt/src/domain/exceptions
 */

export class SubiektBridgeAuthError extends Error {
  /** Bridge HTTP status that triggered this (401 or 403). */
  readonly status: number;

  constructor(status: number) {
    super('Subiekt bridge authentication failed (check bridge token/credentials)');
    this.name = 'SubiektBridgeAuthError';
    this.status = status;
    Error.captureStackTrace(this, this.constructor);
  }
}
