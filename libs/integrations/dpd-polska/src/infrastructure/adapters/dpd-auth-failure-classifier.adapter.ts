/**
 * DPD Polska Auth Failure Classifier Adapter
 *
 * Implements `AuthFailureClassifierPort` (#819) for DPD Polska — answers the
 * `SyncJobRunner`'s "does this terminal failure mean the connection's
 * credentials were rejected (re-authentication required)?" question for DPD's
 * exception hierarchy. Self-registered by the DPD plugin's `register(host)`
 * against `AuthFailureClassifierRegistryService`.
 *
 * Credential-rejection (return `true`):
 *   - `DpdUnauthorizedException` — thrown by BOTH the DPDServices REST client
 *     and the DPD InfoServices SOAP client on a non-retryable `401`/`403`
 *     (bad Basic-auth pair / `MISSING_PERMISSION`). It extends the core
 *     `ShippingProviderAuthException` (#1102), so checking the plugin subclass
 *     here covers every DPD path that can surface a credential rejection.
 *
 * Everything else (return `false`):
 *   - `ShippingProviderRejectionException` (deterministic 4xx / validation
 *     rejects — a business problem, not a credential one),
 *   - `DpdNetworkException` (retryable transport), unknown errors.
 *
 * @module libs/integrations/dpd-polska/src/infrastructure/adapters
 * @implements {AuthFailureClassifierPort}
 */
import type { AuthFailureClassifierPort } from '@openlinker/core/sync';
import { DpdUnauthorizedException } from '../../domain/exceptions/dpd-unauthorized.exception';

export class DpdAuthFailureClassifierAdapter implements AuthFailureClassifierPort {
  isCredentialRejected(cause: unknown): boolean {
    return cause instanceof DpdUnauthorizedException;
  }
}
