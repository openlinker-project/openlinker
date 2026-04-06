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

