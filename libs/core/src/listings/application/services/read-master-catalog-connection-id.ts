/**
 * Read Master Catalog Connection Id
 *
 * Pure helper: the master catalogue connection a destination connection's
 * offers are built from, read from its config. Shared by the offer builder and
 * the projection preview (#3995) so both resolve the same source connection -
 * the source connection scopes which mappings and rules apply.
 *
 * @module libs/core/src/listings/application/services
 */

export function readMasterCatalogConnectionId(
  config: Record<string, unknown> | null | undefined
): string | null {
  if (!config) return null;
  const value = config['masterCatalogConnectionId'];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
