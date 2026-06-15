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
 * Mirrors `CreateOfferOverridesDto` on the BE — kept narrow to the keys the
 * bulk wizard actually populates.
 */
export interface BulkOfferOverrides {
  title?: string;
  description?: string | null;
  categoryId?: string;
  /** Catalogue product-card id from a unique EAN match (#808). */
  productCardId?: string;
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
   * Step 1) — Allegro's offer-creation contract requires this on every offer.
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
}

export interface BulkOfferCreateRequest {
  connectionId: string;
  /** Variant IDs (despite the field name — see file header). */
  productIds: string[];
  sharedConfig: BulkSharedConfig;
  perProductOverrides?: Record<string, BulkPerProductOverride>;
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
