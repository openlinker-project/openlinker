/**
 * Bulk Offer Creation Submit Types (#736)
 *
 * Input / result contracts for the bulk submission service that fans an
 * N-product bulk submission out across the existing offer-creation enqueue
 * flow: validate connection + capability, persist a parent
 * `BulkListingBatch`, enqueue one `marketplace.offer.create` job per
 * product carrying `MarketplaceOfferCreatePayloadV2`, return the batchId +
 * jobIds for FE polling.
 *
 * Worker-side handling (consuming the V2 payload, calling
 * `BulkListingBatchRepositoryPort.incrementCounters` on terminal
 * status) lands in **#737**; this slice defines the submit/read seam only.
 *
 * @module libs/core/src/listings/application/types
 */

import type { CreateOfferOverrides } from '@openlinker/core/listings';
import type { OfferDescriptionTone } from '@openlinker/core/sync';

import type { BulkListingBatch } from '../../domain/entities/bulk-listing-batch.entity';
import type { OfferCreationRecord } from '../../domain/entities/offer-creation-record.entity';

/**
 * Per-batch shared submission config. Applied to every product in the
 * batch unless an entry in `perProductOverrides` provides a narrower
 * value. The shape is intentionally a small typed surface (not a free
 * `Record<string, unknown>`) so DTO validation can reject malformed
 * payloads at the boundary; the entity's `sharedConfig` column is the
 * persisted (untyped) projection.
 */
export interface BulkSharedConfig {
  /** Offered stock quantity applied to every product. */
  stock: number;
  /** Publish-immediately flag applied to every product. */
  publishImmediately: boolean;
  /** Optional default price for every product (overridable per-product). */
  price?: { amount: number; currency: string };
  /** Optional shared overrides (e.g. category, platform params). */
  overrides?: CreateOfferOverrides;
  /** Operator opted into AI description generation for this batch. */
  generateDescription?: boolean;
  /** Optional AI tone hint forwarded to the prompt template (#737). */
  descriptionTone?: OfferDescriptionTone;
}

/**
 * Per-product override carried alongside the shared config. Each field is
 * optional and falls back to `sharedConfig` when omitted. Surface kept
 * small so the wizard's review-table edit modal in #740 can emit one
 * narrow JSON shape per row.
 */
export interface PerProductOverride {
  stock?: number;
  publishImmediately?: boolean;
  price?: { amount: number; currency: string };
  overrides?: CreateOfferOverrides;
}

/**
 * Service-layer input to `IBulkListingSubmitService.submit`.
 *
 * Distinct from the HTTP DTO: the controller maps from
 * `BulkOfferCreateRequestDto` to this shape and adds `initiatedBy` from
 * the authenticated session. Keeps the service free of HTTP framework
 * coupling.
 */
export interface BulkListingSubmitInput {
  /** Target marketplace connection id. */
  connectionId: string;
  /**
   * Operator user id that submitted the bulk request. Stamped onto the
   * batch's `initiatedBy` column; resolved from the JWT on the controller.
   */
  initiatedBy: string;
  /**
   * OL internal variant ids (`ol_variant_*`) to fan out across. Validated
   * by the controller DTO (length 1..100 + non-empty string each — NOT
   * UUIDs); the service throws `EmptyBulkSubmissionException` if the array
   * is empty as a second line of defense.
   */
  productIds: string[];
  /** Shared submission config applied to every product. */
  sharedConfig: BulkSharedConfig;
  /**
   * Optional per-product overrides keyed by `productIds[i]` (the submitted
   * primary/seed variant id). Applied to the whole variant family as the
   * family-default layer. Entries with unrecognised keys are ignored.
   */
  perProductOverrides?: Record<string, PerProductOverride>;
  /**
   * Optional per-variant overrides keyed by the **actual** variant id of any
   * sibling (#1741). Wins over the family layer field-by-field in
   * `buildEnqueueInput`. Entries with unrecognised keys are ignored.
   */
  perVariantOverrides?: Record<string, PerProductOverride>;
  /**
   * Variant ids to exclude from the fan-out (#1741). `expandVariantJobs`
   * skips these siblings (and never resurrects an excluded seed); `totalCount`
   * reflects the post-exclusion count. A product whose every variant is
   * excluded contributes zero jobs.
   */
  excludedVariantIds?: string[];
}

/**
 * Internal expansion unit produced before the enqueue fan-out (#824).
 *
 * A submitted id is a primary-variant id. For a **multi-variant** product
 * it expands into one job per sibling variant so each lists as its own
 * Allegro offer (Allegro auto-groups them from the Product Catalog by GTIN
 * + distinguishing parameter — there is no variant-set API after 14 Apr
 * 2026). Single-variant products and unknown ids pass through unchanged, so
 * pre-#824 behaviour is byte-identical for them.
 *
 * Not exported from the package barrel — purely an implementation detail of
 * `BulkListingSubmitService`.
 */
export interface ExpandedVariantJob {
  /** The variant this offer-creation job lists. */
  variantId: string;
  /**
   * The originally-submitted id whose `perProductOverrides` entry applies to
   * this job. Equals `variantId` for passthrough jobs and for the selected
   * variant of an expanded family; equals the family's selected id for
   * expanded siblings.
   */
  selectedId: string;
  /**
   * Source `stock` from per-variant master inventory (#823) rather than the
   * shared/override quantity — authoritative, including 0 (an out-of-stock
   * variant is not backfilled with the operator's bulk quantity). Set only
   * for multi-variant expansion jobs.
   */
  useMasterStock: boolean;
  /**
   * Strip the FE-resolved `productCardId` so this variant self-links to its
   * own catalog product by its own barcode. Set for expanded siblings (the
   * card the wizard resolved belongs to the selected variant only).
   */
  clearProductCard: boolean;
}

/**
 * Service-layer result returned by `submit`. The controller maps to
 * `BulkOfferCreateResponseDto` for the HTTP boundary.
 */
export interface BulkListingSubmitResult {
  /** Persisted batch id (UUID). */
  batchId: string;
  /**
   * Redis Streams message ids, one per enqueued offer. Positional with the
   * expanded job list — for a multi-variant product this is one id per
   * variant, so the array can be longer than the submitted `productIds`
   * (#824).
   */
  jobIds: string[];
}

/**
 * Aggregate summary returned by `IBulkListingSubmitService.getBatch`.
 * The controller maps to `BulkBatchSummaryDto`; the FE poll page in #741
 * renders this shape directly.
 */
export interface BulkBatchSummary {
  batch: BulkListingBatch;
  /**
   * Per-product child rows, ordered by `createdAt ASC` so the wizard's
   * review table renders rows in submission order even after retries.
   */
  records: OfferCreationRecord[];
}
