/**
 * Shoper Auth Failure Classifier Adapter
 *
 * Tells the host which Shoper failures mean the credentials were rejected, so
 * a connection can be flagged `needs_reauth` instead of retried. Only a
 * `ShoperApiError` that `isAuthRejection()` qualifies (`401`, or `403` for a
 * missing scope). Network errors, timeouts and 5xx say nothing about the token
 * and must not push a healthy connection into re-authentication.
 *
 * @module libs/integrations/shoper/src/infrastructure/adapters
 * @implements {AuthFailureClassifierPort}
 */
import type { AuthFailureClassifierPort } from '@openlinker/core/sync';

import { ShoperApiError } from '../../domain/exceptions/shoper-api.error';

export class ShoperAuthFailureClassifierAdapter implements AuthFailureClassifierPort {
  isCredentialRejected(cause: unknown): boolean {
    return cause instanceof ShoperApiError && cause.isAuthRejection();
  }
}
