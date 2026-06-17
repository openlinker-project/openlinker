/**
 * DPD Unauthorized Exception
 *
 * Thrown when DPDServices rejects the request with `401` (bad Basic-auth
 * pair / `MISSING_PERMISSION`) or `403`. Not retryable.
 *
 * Extends the neutral core `ShippingProviderAuthException` so the HTTP
 * controller classifies it (→ 502) via `instanceof` without importing this
 * plugin-private type (CORE ↔ Integration boundary). Importing a core exception
 * here follows the existing `ShippingProviderRejectionException` precedent.
 *
 * @module libs/integrations/dpd-polska/src/domain/exceptions
 */
import { ShippingProviderAuthException } from '@openlinker/core/shipping';

export class DpdUnauthorizedException extends ShippingProviderAuthException {
  constructor(message: string, connectionId?: string) {
    super('dpd', message, connectionId);
    this.name = 'DpdUnauthorizedException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DpdUnauthorizedException);
    }
  }
}
