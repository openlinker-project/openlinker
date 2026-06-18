/**
 * InPost Unauthorized Exception
 *
 * Thrown when ShipX rejects the request with `401 unauthorized` or
 * `403 access_forbidden` — a bad/expired API token or insufficient token
 * permissions. Not retryable.
 *
 * Extends the neutral core `ShippingProviderAuthException` so the HTTP
 * controller classifies it (→ 502) via `instanceof` without importing this
 * plugin-private type (CORE ↔ Integration boundary).
 *
 * @module libs/integrations/inpost/src/domain/exceptions
 */
import { ShippingProviderAuthException } from '@openlinker/core/shipping';

export class InpostUnauthorizedException extends ShippingProviderAuthException {
  constructor(message: string, connectionId?: string) {
    super('inpost', message, connectionId);
    this.name = 'InpostUnauthorizedException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, InpostUnauthorizedException);
    }
  }
}
