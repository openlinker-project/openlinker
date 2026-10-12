/**
 * Shoper Product Id Resolution
 *
 * Resolves an OpenLinker internal product id to this connection's Shoper id
 * through the identifier mapping. Shared by the `ProductMaster` and
 * `InventoryMaster` adapters.
 *
 * A missing mapping is a mapping GAP, not a statement about the shop, so it
 * raises the platform-native `ShoperNotMappedException` - never the neutral
 * `MasterProductNotFoundError`, which is reserved for a platform-reported
 * absence (an inferred one must not stale a catalogue).
 *
 * @module libs/integrations/shoper/src/infrastructure/readers
 */
import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';

import { ShoperNotMappedException } from '../../domain/exceptions/shoper-not-mapped.exception';

export async function resolveShoperExternalProductId(
  identifierMapping: IdentifierMappingPort,
  connectionId: string,
  productId: string,
): Promise<string> {
  const mappings = await identifierMapping.getExternalIds(CORE_ENTITY_TYPE.Product, productId);
  const mapping = mappings.find((m) => m.connectionId === connectionId);
  if (mapping === undefined) {
    throw new ShoperNotMappedException(productId, connectionId);
  }
  return mapping.externalId;
}
