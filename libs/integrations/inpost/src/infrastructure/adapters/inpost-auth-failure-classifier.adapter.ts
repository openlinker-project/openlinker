/**
 * InPost Auth Failure Classifier Adapter
 *
 * Implements `AuthFailureClassifierPort` (#819) for InPost — answers the
 * `SyncJobRunner`'s "does this terminal failure mean the connection's
 * credentials were rejected (re-authentication required)?" question for InPost's
 * exception hierarchy. Self-registered by the InPost plugin's `register(host)`
 * against `AuthFailureClassifierRegistryService`.
 *
 * Credential-rejection (return `true`):
 *   - `InpostUnauthorizedException` — thrown by the single ShipX HTTP client on
 *     a non-retryable `401 unauthorized` / `403 access_forbidden` (bad/expired
 *     API token or insufficient permissions). It extends the core
 *     `ShippingProviderAuthException` (#1102), so this covers every InPost path.
 *
 * Everything else (return `false`):
 *   - `ShippingProviderRejectionException` (deterministic 4xx / field-validation
 *     rejects — a business problem, not a credential one),
 *   - `InpostNetworkException` (retryable transport), unknown errors.
 *
 * @module libs/integrations/inpost/src/infrastructure/adapters
 * @implements {AuthFailureClassifierPort}
 */
import type { AuthFailureClassifierPort } from '@openlinker/core/sync';
import { InpostUnauthorizedException } from '../../domain/exceptions/inpost-unauthorized.exception';

export class InpostAuthFailureClassifierAdapter implements AuthFailureClassifierPort {
  isCredentialRejected(cause: unknown): boolean {
    return cause instanceof InpostUnauthorizedException;
  }
}
