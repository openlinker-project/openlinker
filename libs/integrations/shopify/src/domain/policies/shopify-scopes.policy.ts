/**
 * Shopify Scopes Policy
 *
 * Which of the Admin API scopes the capabilities need a granted set does not
 * cover. Shared by the connection tester (an installed app) and the OAuth
 * code exchange (the scopes a merchant just granted).
 *
 * @module libs/integrations/shopify/src/domain/policies
 */
import { SHOPIFY_REQUIRED_SCOPES } from '../../shopify.constants';

/** Required scopes not granted; a granted `write_*` scope implies its `read_*` scope on Shopify. */
export function findMissingShopifyScopes(granted: ReadonlySet<string>): string[] {
  return SHOPIFY_REQUIRED_SCOPES.filter(
    (scope) => !granted.has(scope) && !granted.has(scope.replace(/^read_/, 'write_')),
  );
}
