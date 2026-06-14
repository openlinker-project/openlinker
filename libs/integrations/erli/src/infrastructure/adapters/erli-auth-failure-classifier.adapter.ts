/**
 * Erli Auth Failure Classifier Adapter
 *
 * Implements `AuthFailureClassifierPort` for Erli — answers the runner's "does
 * this terminal failure mean the credentials were rejected (re-auth required)?"
 * Registered in `createErliPlugin().register(host)` (#984; ADR-008).
 *
 * Credential-rejection (`true`): `ErliAuthenticationException` only — the #981
 * client raises it on a 401/403 from the static bearer key, which is exactly a
 * revoked/invalid key → flip the connection to `needs_reauth`. Everything else
 * (deterministic 4xx `ErliApiException`, network, rate-limit, unknown) is not a
 * credential rejection.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters
 * @implements {AuthFailureClassifierPort}
 */
import type { AuthFailureClassifierPort } from '@openlinker/core/sync';
import { ErliAuthenticationException } from '../../domain/exceptions/erli-authentication.exception';

export class ErliAuthFailureClassifierAdapter implements AuthFailureClassifierPort {
  isCredentialRejected(cause: unknown): boolean {
    return cause instanceof ErliAuthenticationException;
  }
}
