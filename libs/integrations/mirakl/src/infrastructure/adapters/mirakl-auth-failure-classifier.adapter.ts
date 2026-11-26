/**
 * Mirakl Auth Failure Classifier Adapter
 *
 * A `MiraklAuthenticationException` (401/403 on the shop key) means the key was
 * revoked, regenerated in the back office, or belongs to the other environment.
 * The runner then flips the connection to `needs_reauth` (ADR-008) instead of
 * retrying it. Nothing else counts as a credential rejection.
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 * @implements {AuthFailureClassifierPort}
 */
import type { AuthFailureClassifierPort } from '@openlinker/core/sync';
import { MiraklAuthenticationException } from '../../domain/exceptions/mirakl-authentication.exception';

export class MiraklAuthFailureClassifierAdapter implements AuthFailureClassifierPort {
  isCredentialRejected(cause: unknown): boolean {
    return cause instanceof MiraklAuthenticationException;
  }
}
