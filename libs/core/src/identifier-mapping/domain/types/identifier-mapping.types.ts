/**
 * Identifier Mapping Types
 *
 * Type definitions for identifier mapping operations. Defines entity types,
 * mapping context, request structures, and external ID mapping structures.
 *
 * @module libs/core/src/identifier-mapping/domain/types
 */
export const EntityTypeValues = [
  'Product',
  'ProductVariant',
  'Sku',
  'Order',
  'Offer',
  'Inventory',
  'Customer',
] as const;

export type EntityType = (typeof EntityTypeValues)[number];

/**
 * Entity types whose internal-ID prefix diverges from `entityType.toLowerCase()`.
 *
 * The default format is `ol_{entityType.toLowerCase()}_{uuid}`. Entries here
 * override the prefix segment only. `ProductVariant` maps to `variant` so IDs
 * remain the documented `ol_variant_*` shape (see `docs/architecture-overview.md`
 * §"Internal Identifier Format") rather than the verbose `ol_productvariant_*`
 * that the default lowercasing would produce.
 */
export const ENTITY_TYPE_ID_PREFIX: Partial<Record<EntityType, string>> = {
  ProductVariant: 'variant',
};

export interface MappingContext {
  parentEntityType?: string;
  parentInternalId?: string;
  metadata?: Record<string, unknown>;
}

export interface IdentifierMappingRequest {
  entityType: EntityType;
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

