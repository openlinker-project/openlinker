/**
 * Bundles API types (#3624)
 *
 * Mirrors `apps/api/src/products/http/dto/bundle-definition.dto.ts`. A bundle
 * is an ordinary product that also has components; the browser cannot import
 * `@openlinker/core` (#591), so the shapes are restated here.
 *
 * @module apps/web/src/features/bundles/api
 */

export interface BundleProductSummary {
  name: string | null;
  sku: string | null;
  /** Gross catalogue price. */
  price: number | null;
  currency: string | null;
}

export interface BundleComponent {
  variantId: string;
  productId: string;
  quantity: number;
  giftSlot?: boolean;
}

export interface BundleDefinition {
  variantId: string;
  version: number;
  components: BundleComponent[];
}

export interface BundleComponentAvailability extends BundleComponent {
  summary: BundleProductSummary;
  /** `null` = unknown, never zero. */
  availableToPromise: number | null;
  bundlesSupported: number | null;
}

export interface BundleDetail extends BundleDefinition {
  bundle: BundleProductSummary;
  openOrdersOnOlderComposition: number;
  componentAvailability: BundleComponentAvailability[];
  /** `null` when any component is unknown. */
  bundlesAvailable: number | null;
}

export interface BundleCreated extends BundleDefinition {
  /** Orders that were waiting for a bundle and were sent to be ingested again. */
  releasedOrders: number;
}

export interface BundleHistoryEntry extends BundleDefinition {
  /** When this version was written (ISO 8601). */
  createdAt: string;
  current: boolean;
  openOrders: number;
  componentSummaries: BundleProductSummary[];
}

export interface BundleUsedIn {
  bundleVariantId: string;
  quantity: number;
  giftSlot?: boolean;
  bundle: BundleProductSummary;
}

export interface BundleComponentInput {
  variantId: string;
  quantity: number;
  giftSlot?: boolean;
}

/** The machine codes the API sends when a definition is refused (409 / 400). */
export const BundleNestingReasonValues = [
  'component-is-bundle',
  'variant-is-component',
  'component-is-self',
] as const;
export type BundleNestingReason = (typeof BundleNestingReasonValues)[number];

export function isBundleNestingReason(value: unknown): value is BundleNestingReason {
  return BundleNestingReasonValues.some((reason) => reason === value);
}
