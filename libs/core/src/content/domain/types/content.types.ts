/**
 * Content Domain Types
 *
 * Type definitions for product content fields. `FieldKey` is the extension
 * point — MVP supports `description`; future keys (title, short description,
 * SEO meta) can be added without schema changes.
 *
 * @module libs/core/src/content/domain/types
 */

/**
 * Runtime array of supported content field keys.
 *
 * Add a new field key here, then no further migration is needed — the
 * `product_content_field` table is keyed on `(productId, connectionId, fieldKey)`
 * and accepts any string. The union exists only to keep callers honest.
 */
export const FieldKeyValues = ['description'] as const;
export type FieldKey = (typeof FieldKeyValues)[number];

/**
 * Information about a divergence detected during inbound reconcile while a
 * pending draft existed. Surfaced via the `hasConflict` flag on the row;
 * future iterations may emit a domain event with this payload so a
 * resolution UI can render side-by-side diffs.
 */
export interface ContentConflictInfo {
  fieldKey: FieldKey;
  baseVersion: string | null;
  externalVersion: string;
}
