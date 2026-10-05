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

  /**
   * The bridge's OWN explanation, when it gave one.
   *
   * Carried because the bridge distinguishes two states an operator must act on
   * differently — "bad or missing bridge token" (the value is wrong) versus
   * "bridge token is not configured - set InvoiceToken in appsettings.json or
   * OL_BRIDGE_INVOICE_TOKEN" (nothing was ever set, so every `/api/*` route is
   * closed). Before this field the caller saw only the generic sentence below
   * and could not tell them apart.
   *
   * SAFETY: the client redacts the token from this string before constructing
   * the error, and caps its length, so a misbehaving bridge cannot echo the
   * credential back into a log or an operator-facing message. `undefined` when
   * the body carried no readable reason.
   */
  readonly reason: string | undefined;

  /**
   * Neutral failure discriminator (#1200) read STRUCTURALLY by core. A 401/403 is
   * rejected at the bridge BEFORE the request reaches Subiekt, so NO document was
   * created — the row is SAFE to re-attempt once the credential is fixed.
   */
  readonly failureMode = 'rejected' as const;

  constructor(status: number, reason?: string) {
    const base = 'Subiekt bridge authentication failed (check bridge token/credentials)';
    super(reason !== undefined && reason.length > 0 ? `${base}: ${reason}` : base);
    this.name = 'SubiektBridgeAuthError';
    this.status = status;
    this.reason = reason !== undefined && reason.length > 0 ? reason : undefined;
    Error.captureStackTrace(this, this.constructor);
  }
}
