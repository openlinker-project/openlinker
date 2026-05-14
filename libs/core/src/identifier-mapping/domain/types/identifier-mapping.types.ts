/**
 * Identifier Mapping Types
 *
 * Type definitions for identifier mapping operations. Defines the well-known
 * core entity types, mapping context, request structures, and external ID
 * mapping structures.
 *
 * @module libs/core/src/identifier-mapping/domain/types
 */

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
 * Named-constant map for the well-known core entity types (#668).
 *
 * Lets call sites reference entity types by name (`CORE_ENTITY_TYPE.Product`)
 * rather than repeating bare `'Product'` / `'Customer'` literals. The port
 * signature deliberately stays open (`string`) so plugin adapters can register
 * additional names; this map is only the well-known closed set.
 *
 * `as const satisfies Record<CoreEntityType, CoreEntityType>` ensures the keys
 * remain in lockstep with the union (drops an entry → TS errors; types a value
 * to a non-member literal → TS errors).
 */
export const CORE_ENTITY_TYPE = {
  Product: 'Product',
  ProductVariant: 'ProductVariant',
  Sku: 'Sku',
  Order: 'Order',
  Offer: 'Offer',
  Inventory: 'Inventory',
  Customer: 'Customer',
} as const satisfies Record<CoreEntityType, CoreEntityType>;

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
