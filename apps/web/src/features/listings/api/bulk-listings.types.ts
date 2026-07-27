/**
 * Bulk Listing Types
 *
 * FE transport types for the bulk offer-creation endpoints (#736 / #742).
 * Mirrors the BE DTOs in `apps/api/src/listings/http/dto/bulk-offer-create*.dto.ts`
 * and `bulk-listing-retry-response.dto.ts`.
 *
 * Note: the BE field `productIds` actually carries **variant IDs** (see
 * `libs/core/src/listings/application/services/bulk-listing-submit.service.ts:182`
 * where `internalVariantId: productId`). The FE picks one canonical variant
 * per selected product before submit.
 *
 * @module apps/web/src/features/listings/api
 */

import type { OfferCreationError, OfferCreationStatus, OfferParameter } from './listings.types';
// Type-only (erased at build) - per-product pricing/stock policy overrides
// (#1741). Defined alongside the batch policies in `bulk-wizard.types`.
import type { PricingPolicy, StockPolicy } from '../components/bulk/bulk-wizard.types';

export const BulkBatchStatusValues = [
  'pending',
  'running',
  'completed',
  'partially-failed',
  'failed',
] as const;
export type BulkBatchStatus = (typeof BulkBatchStatusValues)[number];

export const TERMINAL_BULK_BATCH_STATUSES: readonly BulkBatchStatus[] = [
  'completed',
  'partially-failed',
  'failed',
];

/**
 * Shared offer-override shape used by both `BulkSharedConfig.overrides` (the
 * Step-1 defaults) and `BulkPerProductOverride.overrides` (per-row tweaks).
 * Mirrors `CreateOfferOverridesDto` on the BE - kept narrow to the keys the
 * bulk wizard actually populates.
 */
export interface BulkOfferOverrides {
  title?: string;
  description?: string | null;
  categoryId?: string;
  /** Catalogue product-card id from a unique EAN match (#808). */
  productCardId?: string;
  /**
   * Per-variant EAN/GTIN override (#1741). Rescues a barcode-less sibling and is
   * threaded to both barcode sites in the core `OfferBuilderService` (catalog
   * self-link + EanCategoryMatcher). The BE strips it from perVariant/perProduct
   * maps only for `categoryId`; `ean` is kept. Must be a GS1-valid GTIN-8/13.
   */
  ean?: string;
  imageUrls?: string[] | null;
  /** Operator-picked neutral category parameters (#1071). */
  parameters?: OfferParameter[];
  platformParams?: Record<string, unknown>;
}

export interface BulkSharedConfig {
  stock: number;
  publishImmediately: boolean;
  price?: { amount: number; currency: string };
  /**
   * Shared `CreateOfferOverrides` block. The bulk wizard uses this to carry
   * `platformParams.deliveryPolicyId` (the shipping rate package picked in
   * Step 1) - Allegro's offer-creation contract requires this on every offer.
   */
  overrides?: BulkOfferOverrides;
  generateDescription?: boolean;
  descriptionTone?: string;
}

export interface BulkPerProductOverride {
  stock?: number;
  publishImmediately?: boolean;
  price?: { amount: number; currency: string };
  overrides?: BulkOfferOverrides;
  /**
   * Per-product pricing/stock policy override (#1741). Set from the multi-variant
   * editor's shared-base scope when the operator diverges from the batch policy;
   * the wizard resolves it into concrete per-variant price/stock before submit
   * (it wins over `config.pricingPolicy` / `config.stockPolicy`). Absent ⇒ the
   * product inherits the batch policy. FE-only resolution input - the BE receives
   * the already-resolved amounts and ignores these fields.
   */
  pricingPolicy?: PricingPolicy;
  stockPolicy?: StockPolicy;
}

export interface BulkOfferCreateRequest {
  connectionId: string;
  /** Primary/seed variant IDs, one per selected product (despite the field name - see file header). */
  productIds: string[];
  sharedConfig: BulkSharedConfig;
  /** Family-layer overrides keyed by the submitted primary variant id (#1741). */
  perProductOverrides?: Record<string, BulkPerProductOverride>;
  /**
   * Per-variant overrides keyed by the **actual** sibling variant id (#1741).
   * Wins over the family layer field-by-field in the BE. `categoryId` is
   * stripped server-side (grouping-determining, product-level).
   */
  perVariantOverrides?: Record<string, BulkPerProductOverride>;
  /** Sibling variant ids the operator switched off; skipped in the BE fan-out (#1741). */
  excludedVariantIds?: string[];
}

export interface BulkOfferCreateResponse {
  batchId: string;
  jobIds: string[];
}

export interface BulkBatchRecordSummary {
  id: string;
  internalVariantId: string;
  status: OfferCreationStatus;
  externalOfferId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Structured failure reasons; populated when status=failed, null otherwise (#806). */
  errors: OfferCreationError[] | null;
  /**
   * Product name for the per-product progress rollup (#1741). Optional +
   * forward-compatible: the BE record-summary projection is a coordinated
   * follow-up; when absent the progress table groups by product id and labels
   * rows with the variant id.
   */
  productName?: string | null;
  /**
   * Distinguishing-attribute label for the failed/live variant (e.g. "Rozmiar: M",
   * #1741). When absent the progress table falls back to the raw variant id.
   */
  variantLabel?: string | null;
  /** OL product id, for grouping records into a per-product rollup (#1741). */
  productId?: string | null;
}

export interface BulkBatchSummary {
  id: string;
  connectionId: string;
  status: BulkBatchStatus;
  totalCount: number;
  succeededCount: number;
  failedCount: number;
  createdAt: string;
  updatedAt: string;
  records: BulkBatchRecordSummary[];
}

export interface BulkListingRetryResponse {
  retriedRecordIds: string[];
  retriedCount: number;
  batchStatus: BulkBatchStatus;
}
