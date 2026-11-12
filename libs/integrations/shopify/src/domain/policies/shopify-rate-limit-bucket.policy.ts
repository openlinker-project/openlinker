/**
 * Shopify Rate-Limit Bucket Policy
 *
 * Shopify's API budget is per app AND store, so two connections to one store
 * (say one as a catalogue master, one as an order destination) draw from one
 * budget and must pace against ONE bucket (ADR-038 § Amendment, the Shoper
 * precedent). The bucket is keyed by the normalised store domain. Consulted by
 * every `forConnection` call site in the plugin and, through
 * `AdapterMetadata.resolveRateLimitBucketKey`, by the host's status read.
 *
 * @module libs/integrations/shopify/src/domain/policies
 */
import type { Connection } from '@openlinker/core/identifier-mapping';

import { isShopifyStoreDomain, normaliseShopifyStoreDomain } from './shopify-config.policy';

/**
 * The shared bucket for a connection, or `undefined` (its own bucket) when
 * the store domain is unusable: such a connection cannot reach Shopify, and
 * the call that tries fails with the config error the operator can act on.
 */
export function resolveShopifyRateLimitBucketKey(
  connection: Pick<Connection, 'id' | 'config'>,
): string | undefined {
  const domain = normaliseShopifyStoreDomain((connection.config ?? {})['storeDomain']);
  return isShopifyStoreDomain(domain) ? `shopify:store:${domain}` : undefined;
}
