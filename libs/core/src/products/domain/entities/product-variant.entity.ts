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
  /**
   * Master price for this variant. Persisted on the variants table.
   * Optional at the domain level so adapter drafts and test factories may
   * omit it; the repository / DTO layer normalises `undefined ↔ null` at
   * the persistence and wire boundaries. Do not assign `null` directly to
   * a domain instance — TypeScript will reject it, and the boundary
   * normalisation is what callers should rely on.
   */
  price?: number;
  /** Master-derived, not persisted on the variants table. */
  weight?: number;
  /**
   * Soft-mark set when the variant is deleted at the master — absent from the
   * master's `getProductVariants` response, or the product itself 404s (#1599).
   * Optional at the domain level so adapter drafts and test factories may omit
   * it; the repository normalises `undefined → false` on write. Order-item
   * resolution consults this to fail early instead of passing a zombie variant
   * downstream. Cleared on the variant's reappearance via upsert.
   */
  isStale?: boolean;
  /** Timestamp of the most recent stale-marking; `null`/absent when live. */
  staleAt?: Date | null;
}
