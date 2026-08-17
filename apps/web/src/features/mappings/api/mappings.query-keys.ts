/**
 * Mappings Query Keys
 *
 * @module apps/web/src/features/mappings/api
 */

import type { MappingSide, MappingOptionListKind } from './mappings.types';

export const mappingsQueryKeys = {
  status: (connectionId: string) => ['mappings', connectionId, 'status'] as const,
  carriers: (connectionId: string) => ['mappings', connectionId, 'carriers'] as const,
  payments: (connectionId: string) => ['mappings', connectionId, 'payments'] as const,
  orderStates: (connectionId: string) => ['mappings', connectionId, 'order-states'] as const,
  /** Per-(side, kind) option list — one entry per dropdown so panels invalidate independently. */
  option: (connectionId: string, side: MappingSide, kind: MappingOptionListKind) =>
    ['mappings', connectionId, 'options', side, kind] as const,
  categories: (connectionId: string) => ['mappings', connectionId, 'categories'] as const,
  allegroCategories: (connectionId: string, parentId?: string) =>
    ['mappings', connectionId, 'allegro-categories', parentId ?? 'root'] as const,
  /** Root-to-leaf breadcrumb for a single source (Allegro) category id (#1741). */
  allegroCategoryPath: (connectionId: string, categoryId: string) =>
    ['mappings', connectionId, 'allegro-category-path', categoryId] as const,
  /**
   * Whole-tree category search (#2075). Deliberately NOT `allegro*`-prefixed
   * like its neighbours: the route resolves scope from the connection, so one
   * key shape serves marketplace and shop alike (ADR-037).
   */
  categorySearch: (connectionId: string, query: string, limit?: number) =>
    ['mappings', connectionId, 'category-search', query, limit ?? 'default'] as const,
  /** Fulfillment-routing rules + candidate processors for a source connection (#836). */
  routingRules: (connectionId: string) => ['mappings', connectionId, 'routing-rules'] as const,
  routingCandidates: (connectionId: string) =>
    ['mappings', connectionId, 'routing-candidates'] as const,
  /** Operator-authored attribute mapping rules for a connection (#1841). */
  attributeRules: (connectionId: string) =>
    ['mappings', connectionId, 'attribute-rules'] as const,
};
