/**
 * Category Path Types
 *
 * Neutral node shape returned by `CategoryPathReader.getCategoryPath` - a
 * single ancestor in a marketplace category's root-to-leaf breadcrumb. Used
 * by the bulk-offer wizard to render a human breadcrumb for a category that
 * was auto-resolved from a variant EAN (only the raw id is known up front).
 *
 * @module libs/core/src/listings/domain/types
 */

export interface CategoryPathNode {
  id: string;
  name: string;
}
