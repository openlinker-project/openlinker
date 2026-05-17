/**
 * Bulk Offer Creation Submit Types (#736)
 *
 * Input / result contracts for the bulk submission service that fans an
 * N-product bulk submission out across the existing offer-creation enqueue
 * flow: validate connection + capability, persist a parent
 * `BulkOfferCreationBatch`, enqueue one `marketplace.offer.create` job per
 * product carrying `MarketplaceOfferCreatePayloadV2`, return the batchId +
 * jobIds for FE polling.
 *
 * Worker-side handling (consuming the V2 payload, calling
 * `BulkOfferCreationBatchRepositoryPort.incrementCounters` on terminal
 * status) lands in **#737**; this slice defines the submit/read seam only.
 *
 * @module libs/core/src/listings/application/types
 */

import type { CreateOfferOverrides } from '@openlinker/core/listings';
import type { OfferDescriptionTone } from '@openlinker/core/sync';

import type { BulkOfferCreationBatch } from '../../domain/entities/bulk-offer-creation-batch.entity';
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
 * Service-layer input to `IBulkOfferCreationSubmitService.submit`.
 *
 * Distinct from the HTTP DTO: the controller maps from
 * `BulkOfferCreateRequestDto` to this shape and adds `initiatedBy` from
 * the authenticated session. Keeps the service free of HTTP framework
 * coupling.
 */
export interface BulkOfferCreationSubmitInput {
  /** Target marketplace connection id. */
  connectionId: string;
  /**
   * Operator user id that submitted the bulk request. Stamped onto the
   * batch's `initiatedBy` column; resolved from the JWT on the controller.
   */
  initiatedBy: string;
  /**
   * OL internal variant ids to fan out across. Validated by the
   * controller DTO (length 1..100 + UUID-each); the service throws
   * `EmptyBulkSubmissionException` if the array is empty as a second
   * line of defense.
   */
  productIds: string[];
  /** Shared submission config applied to every product. */
  sharedConfig: BulkSharedConfig;
  /**
   * Optional per-product overrides keyed by `productIds[i]`. Entries with
   * unrecognised keys are ignored.
   */
  perProductOverrides?: Record<string, PerProductOverride>;
}

/**
 * Service-layer result returned by `submit`. The controller maps to
 * `BulkOfferCreateResponseDto` for the HTTP boundary.
 */
export interface BulkOfferCreationSubmitResult {
  /** Persisted batch id (UUID). */
  batchId: string;
  /** Redis Streams message ids, one per enqueued job; positional with `productIds`. */
  jobIds: string[];
}

/**
 * Aggregate summary returned by `IBulkOfferCreationSubmitService.getBatch`.
 * The controller maps to `BulkBatchSummaryDto`; the FE poll page in #741
 * renders this shape directly.
 */
export interface BulkBatchSummary {
  batch: BulkOfferCreationBatch;
  /**
   * Per-product child rows, ordered by `createdAt ASC` so the wizard's
   * review table renders rows in submission order even after retries.
   */
  records: OfferCreationRecord[];
}
