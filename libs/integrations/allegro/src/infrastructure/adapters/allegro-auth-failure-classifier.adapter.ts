/**
 * Allegro Auth Failure Classifier Adapter
 *
 * Implements `AuthFailureClassifierPort` (#819) for the Allegro platform —
 * answers the runner's "does this terminal failure mean the connection's
 * credentials were rejected (re-authentication required)?" question for
 * Allegro's own exception hierarchy. Self-registered by
 * `AllegroIntegrationModule.onModuleInit` against
 * `AuthFailureClassifierRegistryService` alongside the retry classifier.
 *
 * Credential-rejection (return `true`):
 *   - `AllegroAuthenticationException` — the HTTP client throws this only after
 *     a token refresh definitively fails with a credential rejection
 *     (`invalid_grant`, missing/expired refresh token, missing client creds) or
 *     a non-recoverable 401. Transient `network-failure` during refresh is
 *     surfaced as `AllegroNetworkException` (retryable) and never reaches here,
 *     so a one-second blip on `auth.allegro.pl` will not flag the connection
 *     for re-auth (#499 classification preserved).
 *
 * Everything else (return `false`):
 *   - `AllegroApiException` deterministic 4xx (422 validation, …) — non-retryable
 *     but a business/data problem, not a credential rejection.
 *   - Network / rate-limit / unknown errors — not credential rejections.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters
 * @implements {AuthFailureClassifierPort}
 */
import type { AuthFailureClassifierPort } from '@openlinker/core/sync';
import { AllegroAuthenticationException } from '../../domain/exceptions/allegro-authentication.exception';

export class AllegroAuthFailureClassifierAdapter implements AuthFailureClassifierPort {
  isCredentialRejected(cause: unknown): boolean {
    return cause instanceof AllegroAuthenticationException;
  }
}
