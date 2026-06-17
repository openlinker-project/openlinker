/**
 * Shipping Provider Auth Exception
 *
 * Neutral, cross-boundary seam for a shipping carrier rejecting OUR
 * credentials (HTTP 401 / 403) — a bad/expired key, wrong account, or
 * insufficient permission. Sibling of {@link ShippingProviderRejectionException}:
 * a credential failure is distinct from a command rejection, so the HTTP
 * controller can map it deliberately (502 Bad Gateway) instead of letting it
 * fall through to a misleading 500 "Unclassified" error.
 *
 * **Closed-core, open-runtime** (matches #576 / #580 / #769): no per-plugin
 * subclass is required, but plugin-private exceptions (e.g.
 * `DpdUnauthorizedException`, `InpostUnauthorizedException`) MAY extend this so
 * the core controller can classify them via `instanceof` without importing the
 * plugin type (which would violate the CORE ↔ Integration boundary).
 *
 * @module libs/core/src/shipping/domain/exceptions
 */
export class ShippingProviderAuthException extends Error {
  constructor(
    public readonly providerName: string,
    message: string,
    public readonly connectionId?: string,
  ) {
    super(message);
    this.name = 'ShippingProviderAuthException';
    Error.captureStackTrace(this, this.constructor);
  }
}
