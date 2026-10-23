/**
 * Subiekt Bridge — error types
 *
 * The two failure shapes the bridge client surfaces. Both the real HTTP client
 * (#753) and the in-memory fake (#754) throw these, so adapter `.rejects`
 * assertions are portable across implementations.
 *
 * @module libs/integrations/subiekt/bridge
 */

/** The bridge service could not be reached (network / service-down). */
export class SubiektBridgeUnreachableError extends Error {
  constructor(message = 'Subiekt bridge is unreachable') {
    super(message);
    this.name = 'SubiektBridgeUnreachableError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/** The bridge reached Subiekt, but Subiekt rejected the request (e.g. invalid NIP). */
export class SubiektRejectedError extends Error {
  /**
   * `code` is the bridge envelope's own machine-readable `error.code`, carried
   * so a caller can tell "no such towar" (`'not_found'`) from every other
   * business refusal without reading free text. It is OPTIONAL because the
   * value is purely additive: every construction site that predates it keeps
   * compiling and behaves exactly as before, and `looksLikeSubiektNotFound`
   * falls back to the prose when it is absent.
   */
  constructor(
    public readonly reason: string,
    public readonly code?: string,
  ) {
    super(`Subiekt rejected the request: ${reason}`);
    this.name = 'SubiektRejectedError';
    Error.captureStackTrace(this, this.constructor);
  }
}
