/**
 * Subiekt Unsupported Document Type Exception (#753) — TERMINAL
 *
 * Thrown when a neutral document type outside this adapter's supported set
 * (`{invoice, receipt}`) reaches the bridge-native mapper. `getSupportedDocumentTypes()`
 * advertises exactly what this provider issues; anything else is a caller
 * contract violation surfaced as a TERMINAL error, never silent passthrough.
 *
 * @module libs/integrations/subiekt/src/domain/exceptions
 */

export class SubiektUnsupportedDocumentTypeError extends Error {
  /**
   * Neutral failure discriminator (#1200) read STRUCTURALLY by core. A
   * deterministic caller-contract violation raised in the mapper before any
   * request leaves the adapter — NO document was created, so SAFE to re-attempt.
   */
  readonly failureMode = 'rejected' as const;

  constructor(readonly documentType: string) {
    super(
      `Subiekt does not support document type "${documentType}". Supported: invoice, receipt.`,
    );
    this.name = 'SubiektUnsupportedDocumentTypeError';
    Error.captureStackTrace(this, this.constructor);
  }
}
