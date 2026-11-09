/**
 * Shopify External Id Resolution
 *
 * Resolves an OpenLinker internal id to this connection's Shopify (numeric)
 * id through the identifier mapping. A missing mapping is a mapping GAP and
 * raises `ShopifyNotMappedException`, never the neutral not-found error.
 *
 * @module libs/integrations/shopify/src/infrastructure/readers
 */
import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';

import { ShopifyNotMappedException } from '../../domain/exceptions/shopify-not-mapped.exception';

export async function resolveShopifyExternalId(
  identifierMapping: IdentifierMappingPort,
  connectionId: string,
  entityType: string,
  internalId: string,
): Promise<string> {
  const mappings = await identifierMapping.getExternalIds(entityType, internalId);
  const externalId = mappings.find((m) => m.connectionId === connectionId)?.externalId;
  if (externalId === undefined) {
    throw new ShopifyNotMappedException(entityType, internalId, connectionId);
  }
  return externalId;
}
