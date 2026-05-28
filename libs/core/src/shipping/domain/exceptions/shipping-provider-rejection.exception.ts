/**
 * Shipping Provider Rejection Exception
 *
 * Thrown when a shipping provider (carrier API) rejects an OL command — e.g.
 * `generateLabel` returns 4xx, `getTracking` returns a structured error
 * payload, or the provider's idempotency model conflicts with our retry. This
 * is **distinct from internal errors** (DB drops, missing config, programming
 * bugs) — the controller maps this to HTTP 502 (Bad Gateway) while letting
 * non-typed Errors bubble up to Nest's default 500 handler.
 *
 * Adapters opt in by wrapping their provider-side rejection branches with
 * this exception (or by `throw`-rethrowing a caught upstream error wrapped in
 * one). Until every adapter is migrated, the controller's catch-all
 * fallthrough still maps bare `Error` to 502 — but new adapters should throw
 * this typed exception so the migration completes additively.
 *
 * @module libs/core/src/shipping/domain/exceptions
 */
export class ShippingProviderRejectionException extends Error {
  constructor(
    public readonly providerName: string,
    public readonly providerCode: string | null,
    message: string,
  ) {
    super(`Shipping provider ${providerName} rejected the command: ${message}`);
    this.name = 'ShippingProviderRejectionException';
    Error.captureStackTrace(this, this.constructor);
  }
}
