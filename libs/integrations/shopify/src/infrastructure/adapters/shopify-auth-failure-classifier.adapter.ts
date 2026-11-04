/**
 * Shopify Auth-Failure Classifier
 *
 * Recognises a failure that means the stored credentials are no longer
 * accepted, so the host flips the connection to `needs_reauth` (#819). A
 * 401 from the Admin API (the GraphQL client already re-minted once for a
 * client-credentials connection, so a 401 reaching here is persistent), the
 * "Invalid API key or access token" GraphQL error, and a token grant refused
 * with 400/401 (a wrong client id or secret).
 *
 * A missing scope (`ACCESS_DENIED`) is deliberately NOT one: the credentials
 * are valid, and the fix is granting the scope to the app, not re-entering them.
 *
 * @module libs/integrations/shopify/src/infrastructure/adapters
 */
import type { AuthFailureClassifierPort } from '@openlinker/core/sync';

import { ShopifyApiError } from '../../domain/exceptions/shopify-api.error';
import { ShopifyGraphqlError } from '../../domain/exceptions/shopify-graphql.error';

export class ShopifyAuthFailureClassifierAdapter implements AuthFailureClassifierPort {
  isCredentialRejected(cause: unknown): boolean {
    if (cause instanceof ShopifyApiError) {
      return (
        cause.isAuthRejection() ||
        (cause.statusCode === 400 && /client_credentials grant refused/.test(cause.message))
      );
    }
    return cause instanceof ShopifyGraphqlError && cause.isInvalidToken();
  }
}
