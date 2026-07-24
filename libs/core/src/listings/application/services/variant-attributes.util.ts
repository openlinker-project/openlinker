/**
 * Variant Attributes Util
 *
 * Pure helper shared by `OfferBuilderService` (#1065) and
 * `ProductPublishBuilderService` (#1836) to flatten a variant's freeform
 * `Record<string, string>` attributes into the ordered `OfferVariantAttribute[]`
 * shape both the marketplace `OfferVariantGroup` and the shop
 * `PublishProductVariantGroup` grouping hints carry.
 *
 * @module libs/core/src/listings/application/services
 */

import type { OfferVariantAttribute } from '../../domain/types/offer-create.types';

/**
 * Flatten a variant's attribute map into a sorted, blank-filtered list. Sorted
 * by name so the flattened shape is deterministic regardless of object key
 * insertion order (stable command payloads across re-publishes).
 */
export function flattenAttributes(
  attributes: Record<string, string> | null
): OfferVariantAttribute[] {
  return Object.entries(attributes ?? {})
    .filter(([name, value]) => name.length > 0 && value.length > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => ({ name, value }));
}
