/**
 * Identifier Mapping Types
 *
 * Type definitions for identifier mapping operations. Defines entity types,
 * mapping context, request structures, and external ID mapping structures.
 *
 * @module libs/core/src/identifier-mapping/domain/types
 */
export type EntityType = 'Product' | 'Order' | 'Offer' | 'Inventory' | 'Customer';

export interface MappingContext {
  parentEntityType?: string;
  parentInternalId?: string;
  metadata?: Record<string, unknown>;
}

export interface IdentifierMappingRequest {
  entityType: EntityType;
  externalId: string;
  platformId: string;
  context?: MappingContext;
}

export interface ExternalIdMapping {
  externalId: string;
  platformId: string;
  entityType: string;
}

