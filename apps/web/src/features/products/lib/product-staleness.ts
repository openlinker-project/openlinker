/**
 * Product Staleness Derivation
 *
 * Pure, framework-free view-model helper that reduces a product's
 * `variantCount` / `staleVariantCount` list-enrichment fields (#2447) into a
 * card-level "deleted at source" badge view. Mirrors the shape of
 * `deriveOrderHealth` (`features/orders/lib/order-health.ts`) — kept here so
 * the rule is unit-testable apart from the page/components.
 *
 * @module apps/web/src/features/products/lib
 */
import type { Product } from '../api/products.types';
import type { StatusBadgeTone } from '../../../shared/ui/status-badge';

export interface ProductStalenessView {
  /** True when EVERY variant is stale — the product has nothing sellable left. */
  isFullyStale: boolean;
  tone: StatusBadgeTone;
  label: string;
}

/**
 * Derive the staleness badge for a product, or `null` when it has no stale
 * variants (the common case — renders nothing). A product with zero
 * variants, or with `staleVariantCount`/`variantCount` absent (a payload
 * that predates #2447's list enrichment), is never flagged.
 */
export function deriveProductStaleness(product: Product): ProductStalenessView | null {
  const staleCount = product.staleVariantCount ?? 0;
  const totalCount = product.variantCount ?? 0;
  if (staleCount <= 0 || totalCount <= 0) return null;

  const isFullyStale = staleCount >= totalCount;
  return isFullyStale
    ? { isFullyStale, tone: 'error', label: 'Deleted at source' }
    : {
        isFullyStale,
        tone: 'warning',
        label: `${staleCount} of ${totalCount} variants deleted at source`,
      };
}
