/**
 * Subiekt Config Exception (#753)
 *
 * Thrown when a Subiekt connection is in an invalid configuration state that
 * prevents the adapter / HTTP client from being constructed — e.g. a missing or
 * malformed `bridgeBaseUrl`, or a URL that fails the SSRF safety guard. Mirrors
 * `WooCommerceConfigException`. Operator-readable; carries the offending field
 * and value, never a secret.
 *
 * @module libs/integrations/subiekt/src/domain/exceptions
 */

export class SubiektConfigException extends Error {
  /**
   * Neutral failure discriminator (#1200) read STRUCTURALLY by core. A
   * deterministic config / SSRF-guard failure raised BEFORE any request leaves
   * the client — NO document was created, so SAFE to re-attempt once fixed.
   */
  readonly failureMode = 'rejected' as const;

  constructor(
    message: string,
    readonly field: string,
    readonly value: unknown,
  ) {
    super(message);
    this.name = 'SubiektConfigException';
    Error.captureStackTrace(this, this.constructor);
  }
}
