/**
 * Bundles API types (#3624)
 *
 * Mirrors `apps/api/src/products/http/dto/bundle-definition.dto.ts`. A bundle
 * is an ordinary product that also has components; the browser cannot import
 * `@openlinker/core` (#591), so the shapes are restated here.
 *
 * @module apps/web/src/features/bundles/api
 */
import type { GiftDocumentFormChoice } from '../../gift-documents';

export interface BundleProductSummary {
  name: string | null;
  sku: string | null;
  /** Gross catalogue price. */
  price: number | null;
  currency: string | null;
  /** Authenticated API path of the product picture; `null` when there is none. */
  imageUrl: string | null;
}

export interface BundleComponent {
  variantId: string;
  productId: string;
  quantity: number;
  giftSlot?: boolean;
  /** How a document shows the gift slot; absent means as in settings (#3940). */
  documentForm?: GiftDocumentFormChoice;
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
  /** The product the bundle variant belongs to; `null` when it cannot be resolved. */
  productId: string | null;
  /** The product master that can read this bundle's composition; `null` hides the sync action (#3932). */
  composedByMaster: { connectionId: string; connectionName: string } | null;
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

export interface MultipackConfirmed {
  variantId: string;
  packQuantity: number;
  /** Held orders sent to be processed again now. */
  releasedOrders: number;
}

export interface BundleUsedIn {
  bundleVariantId: string;
  /** The component variant this row is about; set by the batched read. */
  componentVariantId?: string;
  quantity: number;
  giftSlot?: boolean;
  bundle: BundleProductSummary;
}

export interface BundleComponentInput {
  variantId: string;
  quantity: number;
  giftSlot?: boolean;
  documentForm?: GiftDocumentFormChoice;
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

/** A product master and whether OpenLinker can create a product in it (#3935). */
export interface BundleCreationTarget {
  connectionId: string;
  connectionName: string;
  platformType: string;
  /** `null`: this master cannot create products from OpenLinker. */
  creationMode: 'simple-product' | null;
}

export interface CreateBundleProductInput {
  connectionId: string;
  name: string;
  sku: string;
  /** Gross price of the whole set. */
  price: number;
  currency?: string;
  ean?: string;
  description?: string;
  /** A component variant whose tax rate the price includes. */
  rateSourceVariantId?: string;
}

export interface CreatedBundleProduct {
  productId: string;
  variantId: string;
  name: string;
  sku: string;
  adopted: boolean;
}
