/**
 * Amazon Auth Failure Classifier
 *
 * Tells the runner which failures mean the stored credentials are rejected,
 * so the connection goes to `needs_reauth` instead of retrying (ADR-008).
 *
 * Only `AmazonAuthenticationError` counts: Login with Amazon refused to mint a
 * token from the refresh token or client credentials. An SP-API `403
 * Unauthorized` is deliberately NOT a credential rejection: Amazon answers it
 * for a missing role or an operation the app is not authorized for as well as
 * for a bad token, and since every call carries a freshly minted token, a 403
 * here is almost always a role or authorization gap. Flipping the connection to
 * `needs_reauth` for that would send the operator to re-authorize something
 * that is not broken.
 *
 * @module libs/integrations/amazon/src/infrastructure/adapters
 * @implements {AuthFailureClassifierPort}
 */
import type { AuthFailureClassifierPort } from '@openlinker/core/sync';

import { AmazonAuthenticationError } from '../../domain/exceptions/amazon-authentication.error';

export class AmazonAuthFailureClassifierAdapter implements AuthFailureClassifierPort {
  isCredentialRejected(cause: unknown): boolean {
    return cause instanceof AmazonAuthenticationError;
  }
}
