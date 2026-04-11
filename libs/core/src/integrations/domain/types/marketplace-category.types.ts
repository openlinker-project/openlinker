/**
 * Marketplace Category Types
 *
 * Unified category type returned by MarketplacePort.fetchCategories().
 * Platform-agnostic representation of a marketplace category node.
 *
 * @module libs/core/src/integrations/domain/types
 */

export interface MarketplaceCategory {
  id: string;
  name: string;
  parentId: string | null;
  leaf: boolean;
}
