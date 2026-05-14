/**
 * Identifier Mapping Types
 *
 * Type definitions for identifier mapping operations. Defines the well-known
 * core entity types, mapping context, request structures, external ID
 * mapping structures, and the shared `formatInternalId` helper.
 *
 * @module libs/core/src/identifier-mapping/domain/types
 */
import { randomUUID } from 'node:crypto';

/**
 * Well-known core entity types — the documented set OpenLinker ships with.
 *
 * Plugin adapters can map additional entity types beyond this set (#577).
 * Port methods accept `string`; this list stays closed and
 * is the source of truth for "well-known."
 */
export const CoreEntityTypeValues = [
  'Product',
  'ProductVariant',
  'Sku',
  'Order',
  'Offer',
  'Inventory',
  'Customer',
] as const;

/**
 * Closed type for the well-known core entity types.
 *
 * Use `CoreEntityType` where exhaustiveness matters (e.g. literal comparisons
 * against `'Offer'` or `'Product'`). Use `string` at port
 * boundaries (e.g. `IdentifierMappingService.getOrCreateInternalId`) where
 * plugin adapters may map additional entity types like `Refund`,
 * `Fulfilment`, `Subscription`. This mirrors the literal `architecture-overview.md`
 * documentation of the port signature.
 */
export type CoreEntityType = (typeof CoreEntityTypeValues)[number];

/**
 * Internal-ID prefix overrides for entity types whose default lowercased
 * prefix is undesirable.
 *
 * The default format is `ol_{entityType.toLowerCase()}_{uuid}`. Entries here
 * override the prefix segment only. `ProductVariant` maps to `variant` so
 * IDs remain the documented `ol_variant_*` shape (see
 * `docs/architecture-overview.md` §"Internal Identifier Format") rather than
 * the verbose `ol_productvariant_*` that the default lowercasing would
 * produce.
 *
 * `Partial<Record<CoreEntityType, string>>` — only well-known core entity
 * types may have prefix overrides registered statically. The lookup type is
 * `string | undefined`, which the existing `?? entityType.toLowerCase()`
 * fallback in `IdentifierMappingService.generateInternalId` handles.
 *
 * Plugin-registered entity types fall through to the lowercased default
 * today. A future `registerEntityType(name, { idPrefix? })` extension hook
 * (#577 follow-up) will be the supported way for plugins to register
 * non-default prefixes.
 */
export const ENTITY_TYPE_ID_PREFIX: Partial<Record<CoreEntityType, string>> = {
  ProductVariant: 'variant',
};

/**
 * Format an internal identifier for an entity.
 *
 * Format: `ol_{prefix}_{uuid_no_dashes}` where `prefix` defaults to
 * `entityType.toLowerCase()` unless overridden in {@link ENTITY_TYPE_ID_PREFIX}
 * (e.g. `ProductVariant` → `'variant'` → `ol_variant_<uuid>`).
 *
 * **Single source of truth.** Used by both the production
 * `IdentifierMappingService` and the in-memory test fake
 * (`InMemoryIdentifierMappingAdapter`). Any change to the on-disk ID shape
 * must land here so production and tests stay in lockstep.
 *
 * @param entityType - well-known {@link CoreEntityType} or a plugin-registered
 *   entity-type string (#577). The override-map lookup is widened to a
 *   string index so plugin types fall through to the lowercased default.
 */
export function formatInternalId(entityType: string): string {
  const overrides: Record<string, string | undefined> = ENTITY_TYPE_ID_PREFIX;
  const uuid = randomUUID().replace(/-/g, '');
  const prefix = overrides[entityType] ?? entityType.toLowerCase();
  return `ol_${prefix}_${uuid}`;
}

export interface MappingContext {
  parentEntityType?: string;
  parentInternalId?: string;
  metadata?: Record<string, unknown>;
}

export interface IdentifierMappingRequest {
  /**
   * Entity type. Open string set — well-known values are in
   * {@link CoreEntityTypeValues}; plugin adapters can register additional
   * names (#577).
   */
  entityType: string;
  externalId: string;
  connectionId: string;
  context?: MappingContext;
}

export interface ExternalIdMapping {
  externalId: string;
  platformType: string;
  connectionId: string;
  entityType: string;
}
