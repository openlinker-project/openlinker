/**
 * Product Variant Domain Entity
 *
 * Represents a product variant (e.g., size/color combinations) in the OpenLinker
 * system. Variants are stored with internal IDs only; external identifiers live
 * in IdentifierMapping. Variants are linked to their parent product via productId.
 *
 * Shape note: this is an `interface` (not a `class`) deliberately. Variants cross
 * adapter → repository → application → UI boundaries and are constructed in
 * several places (adapter mappers, repo `toDomain`, test factories). Structural
 * typing avoids `instanceof` false negatives across import paths and lets
 * repositories build plain objects without a constructor call. Adapters and
 * drafts may omit `createdAt`/`updatedAt` — the repo fills them on load.
 *
 * @module libs/core/src/products/domain/entities
 */
export interface ProductVariant {
  id: string;
  productId: string;
  sku: string | null;
  attributes: Record<string, string> | null;
  ean: string | null;
  gtin: string | null;
  /** Populated by the repository on load; adapters/drafts may omit. */
  createdAt?: Date;
  /** Populated by the repository on load; adapters/drafts may omit. */
  updatedAt?: Date;
  /** Master-derived, not persisted on the variants table. */
  price?: number;
  /** Master-derived, not persisted on the variants table. */
  weight?: number;
}
