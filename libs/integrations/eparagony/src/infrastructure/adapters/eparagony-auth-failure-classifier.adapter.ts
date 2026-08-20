/**
 * eparagony.pl Auth-Failure Classifier
 *
 * Answers the narrower question `AuthFailureClassifierPort` asks (#819): is this
 * a TERMINAL credential rejection, such that the connection should be flagged
 * `needs_reauth` and the scheduler should stop enqueuing dead-on-arrival jobs?
 *
 * Only `401` and `403` qualify. `403` is included because this vendor uses it for
 * a scope mismatch as well as a bad `posId` - both are operator-fixable on the
 * connection, and both make every subsequent call fail identically until fixed.
 *
 * A validation rejection (`400`), an idempotency conflict (`422`) or a rate limit
 * (`429`) must NEVER be classified here: they are non-retryable but say nothing
 * about the credentials, and flagging on them would push a healthy connection
 * into re-authentication.
 *
 * @module libs/integrations/eparagony/src/infrastructure/adapters
 * @implements {AuthFailureClassifierPort}
 */
import type { AuthFailureClassifierPort } from '@openlinker/core/sync';

import { EparagonyApiError } from '../../domain/exceptions/eparagony-api.error';

export class EparagonyAuthFailureClassifierAdapter implements AuthFailureClassifierPort {
  isCredentialRejected(cause: unknown): boolean {
    return cause instanceof EparagonyApiError && cause.isAuthRejection();
  }
}
