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
  /** Populated by the repository on load; adapters/drafts may omit. */
  createdAt?: Date;
  /** Populated by the repository on load; adapters/drafts may omit. */
  updatedAt?: Date;
  /** Master-derived, not persisted on the products table. */
  currency?: string;
  /** Master-derived, not persisted on the products table. */
  weight?: number;
  /** Master-derived (external category IDs), not persisted on the products table. */
  categories?: string[];
}
