/**
 * Shopify Auth-Failure Classifier
 *
 * Recognises a failure that means the stored credentials are no longer
 * accepted, so the host flips the connection to `needs_reauth` (#819, G03):
 *   - a 401 from the Admin API (the client has already renewed a minted or
 *     OAuth token once, so a 401 reaching here is persistent);
 *   - the "Invalid API key or access token" GraphQL error;
 *   - a refused token request whose grant error says the credentials
 *     themselves are wrong or revoked (`invalid_client`,
 *     `application_cannot_be_found`, `unauthorized_client`, and `invalid_grant`
 *     for an OAuth refresh token that is spent or expired).
 *
 * Deliberately NOT: `ACCESS_DENIED` (a missing scope), and `app_not_installed`
 * / `shop_not_permitted` - the credentials are valid, and the fix is in the
 * Shopify admin (install the app, or switch the store to OAuth), not in
 * re-entering them.
 *
 * @module libs/integrations/shopify/src/infrastructure/adapters
 */
import type { AuthFailureClassifierPort } from '@openlinker/core/sync';

import { ShopifyApiError } from '../../domain/exceptions/shopify-api.error';
import { ShopifyGraphqlError } from '../../domain/exceptions/shopify-graphql.error';
import { isCredentialGrantError } from '../../domain/policies/shopify-grant-error.policy';

export class ShopifyAuthFailureClassifierAdapter implements AuthFailureClassifierPort {
  isCredentialRejected(cause: unknown): boolean {
    if (cause instanceof ShopifyApiError) {
      return cause.isAuthRejection() || (cause.isTokenRequestRefused() && isCredentialGrantError(cause.grantError));
    }
    return cause instanceof ShopifyGraphqlError && cause.isInvalidToken();
  }
}
