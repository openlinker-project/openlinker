/**
 * Price Change Auto-Applied View (#3151 review fix)
 *
 * The enriched, dialog-ready projection of a `PriceChangeAutoAppliedLogEntry`
 * — adds product identity (name / variant label / SKU) the same way
 * `PriceChangesService.toQueueItem` already enriches a `PriceChangeEpisode`
 * into a `PriceChangeQueueItem`. Exists so the auto-applied dialog never has
 * to fan out a per-item variant lookup of its own: `productVariantId` alone
 * cannot render a product name, and the raw `PriceChangeAutoAppliedLogEntry`
 * is deliberately anemic (ADR-011) — a bare log fact with no identity
 * resolution of its own.
 *
 * @module libs/core/src/listings/application/types
 */

export interface PriceChangeAutoAppliedView {
  id: string;
  productVariantId: string;
  productName: string;
  variantLabel: string | null;
  sku: string | null;
  destinationConnectionId: string;
  sourceConnectionId: string;
  /** Null for a first-ever detection with no recorded baseline (#3159). */
  oldAmount: number | null;
  newAmount: number;
  currency: string;
  appliedAt: Date;
}
