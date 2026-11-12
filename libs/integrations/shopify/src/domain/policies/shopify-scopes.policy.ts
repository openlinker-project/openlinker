/**
 * Shopify Scopes Policy
 *
 * Which of the Admin API scopes the capabilities need a granted set does not
 * cover. Shared by the connection tester (an installed app) and the OAuth
 * code exchange (the scopes a merchant just granted).
 *
 * @module libs/integrations/shopify/src/domain/policies
 */
import { SHOPIFY_OPTIONAL_SCOPES, SHOPIFY_REQUIRED_SCOPES } from '../../shopify.constants';

function missingFrom(scopes: readonly string[], granted: ReadonlySet<string>): string[] {
  return scopes.filter((scope) => !granted.has(scope) && !granted.has(scope.replace(/^read_/, 'write_')));
}

/** Required scopes not granted; a granted `write_*` scope implies its `read_*` scope on Shopify. */
export function findMissingShopifyScopes(granted: ReadonlySet<string>): string[] {
  return missingFrom(SHOPIFY_REQUIRED_SCOPES, granted);
}

/** Optional scopes not granted: each switches off one optional ability, nothing more. */
export function findMissingOptionalShopifyScopes(granted: ReadonlySet<string>): string[] {
  return missingFrom(SHOPIFY_OPTIONAL_SCOPES, granted);
}

/** What an install asks the merchant for: the required scopes, then the optional ones. */
export const SHOPIFY_REQUESTED_SCOPES: readonly string[] = [...SHOPIFY_REQUIRED_SCOPES, ...SHOPIFY_OPTIONAL_SCOPES];
