/**
 * Shopify Credentials Policy
 *
 * Which of the three ways a stored credential blob reaches the Admin API
 * (`ShopifyCredentialModeValues`), and the fingerprint a cached token is
 * tied to. One function for the shape validator and the token provider, so a
 * blob the validator accepts is always one the provider can use.
 *
 * @module libs/integrations/shopify/src/domain/policies
 */
import { createHash } from 'node:crypto';

import type { ShopifyCredentialMode, ShopifyCredentials } from '../types/shopify-credentials.types';

function filled(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** The mode a blob is used in, or null when it carries none of the three. */
export function resolveShopifyCredentialMode(
  credentials: Readonly<Record<string, unknown>>,
): ShopifyCredentialMode | null {
  if (credentials.grant === 'oauth') {
    return filled(credentials.accessToken) &&
      filled(credentials.refreshToken) &&
      filled(credentials.clientId) &&
      filled(credentials.clientSecret)
      ? 'oauth'
      : null;
  }
  if (filled(credentials.accessToken)) {
    return 'access-token';
  }
  return filled(credentials.clientId) && filled(credentials.clientSecret)
    ? 'client-credentials'
    : null;
}

/**
 * Short hash of the app client id + secret. A token minted with an old secret
 * is never served after the operator rotates it, because the cached entry's
 * fingerprint no longer matches.
 */
export function shopifyCredentialFingerprint(credentials: ShopifyCredentials): string {
  return createHash('sha256')
    .update(`${credentials.clientId ?? ''}:${credentials.clientSecret ?? ''}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Cache key of a connection's minted token. One key per connection - the
 * fingerprint and store domain live inside the cached value - so archiving
 * the connection can drop it without knowing the credential it came from.
 */
export function shopifyAccessTokenCacheKey(connectionId: string): string {
  return `shopify:access-token:${connectionId}`;
}

/** Cache key of a connection's shop context (currency, tax mode, location). */
export function shopifyShopContextCacheKey(connectionId: string): string {
  return `shopify:shop-context:${connectionId}`;
}
