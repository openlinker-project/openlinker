/**
 * Product Domain Entity
 *
 * Represents a canonical product in the OpenLinker system. Products are stored
 * with internal IDs only; external identifiers live in IdentifierMapping.
 * This entity is integration-agnostic and represents the single source of truth
 * for product data.
 *
 * Shape note: this is an `interface` (not a `class`) deliberately. Products cross
 * adapter → repository → application → UI boundaries and are constructed in
 * several places (adapter mappers, repo `toDomain`, test factories). Structural
 * typing avoids `instanceof` false negatives across import paths and lets
 * repositories build plain objects without a constructor call. Adapters and
 * drafts may omit `createdAt`/`updatedAt` — the repo fills them on load.
 *
 * @module libs/core/src/products/domain/entities
 */
export interface Product {
  id: string;
  name: string;
  sku: string | null;
  price: number | null;
  description: string | null;
  images: string[] | null;
  /**
   * ISO 4217 currency code resolved at sync time by the master adapter.
   * Null when the adapter did not provide a currency (e.g., before a per-connection
   * currency setting is configured). Persisted on the products table.
   */
  currency: string | null;
  /** Populated by the repository on load; adapters/drafts may omit. */
  createdAt?: Date;
  /** Populated by the repository on load; adapters/drafts may omit. */
  updatedAt?: Date;
  /** Master-derived, not persisted on the products table. */
  weight?: number;
  /** Master-derived (external category IDs), not persisted on the products table. */
  categories?: string[];
  /**
   * Master-derived full category path (root→leaf), each node carrying the
   * source-shop category id + name (#1096, F3). A richer companion to the bare
   * `categories` ids: a destination that accepts shop-native taxonomy (Erli
   * `source:"shop"`) emits this as a breadcrumb. Absent/unset ⇒ the master could
   * not resolve a path (falls back to the bare-id `categories`). Not persisted on
   * the products table.
   */
  categoryBreadcrumb?: { id: string; name: string }[];
  /**
   * Master-derived product features (e.g. `{ name: 'Material', value: 'Ceramic' }`),
   * distinct from variant-distinguishing attributes (#1096, F2). A destination
   * that accepts shop-native attributes (Erli `source:"shop"` `externalAttributes`)
   * emits these. Absent/empty ⇒ no features. Not persisted on the products table.
   */
  features?: { name: string; value: string }[];
}
