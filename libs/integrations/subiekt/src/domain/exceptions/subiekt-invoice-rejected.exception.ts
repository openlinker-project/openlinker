/**
 * Subiekt Invoice Rejected Exception (#753) — TERMINAL
 *
 * The bridge reached Subiekt but the document was rejected (the frozen
 * `SubiektRejectedError`), or the bridge returned a 2xx with `state: 'failed'`.
 * Either way the issuance will not succeed on retry of the same input — it is a
 * TERMINAL business failure, NOT retryable. Operator-readable `reason`; never
 * carries a secret.
 *
 * @module libs/integrations/subiekt/src/domain/exceptions
 */

export class SubiektInvoiceRejectedError extends Error {
  /**
   * Neutral failure discriminator the core `InvoiceService` reads STRUCTURALLY
   * (#1200) to decide re-attemptability — core never value-imports this class.
   * A rejection is TERMINAL: the provider definitely created NO document, so the
   * row is SAFE to re-attempt.
   */
  readonly failureMode = 'rejected' as const;

  constructor(readonly reason: string) {
    super(`Subiekt rejected the invoice: ${reason}`);
    this.name = 'SubiektInvoiceRejectedError';
    Error.captureStackTrace(this, this.constructor);
  }
}
