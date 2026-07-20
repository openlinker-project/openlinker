/**
 * External-id lookup helper
 *
 * Resolve a specific connection's external id off an entity's
 * `externalIds: ExternalIdMapping[]` array. Mirrors the private helper of the
 * same name in `tests/golden-path/full-flow.spec.ts`; extracted here because
 * the WooCommerce-parity suite (#1571) needs the same lookup across several
 * spec files (product, variant, and order external ids all share the shape).
 *
 * @module support
 */
import type { ExternalIdMapping } from '../api/api.types';

export function externalIdFor(
  externalIds: readonly ExternalIdMapping[] | undefined,
  connectionId: string,
): string | undefined {
  return externalIds?.find((e) => e.connectionId === connectionId)?.externalId;
}
