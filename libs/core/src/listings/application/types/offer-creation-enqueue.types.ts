/**
 * Offer Creation Enqueue Types
 *
 * Input / result contracts for the core pre-enqueue orchestration that sits
 * between the HTTP layer and the sync job queue: validate connection +
 * capability, pre-create the `OfferCreationRecord`, enqueue the
 * `marketplace.offer.create` job.
 *
 * Symmetric with `offer-creation-execution.types.ts` (the post-enqueue
 * worker-side orchestration) so both halves of the create flow have
 * dedicated application-service contracts — per `architecture-overview.md`
 * §6 (sync orchestration lives in core, not in workers or controllers).
 *
 * @module libs/core/src/listings/application/types
 */

import type { CreateOfferOverrides } from '@openlinker/core/listings';
import type { OfferDescriptionTone } from '@openlinker/core/sync';

import type { OfferCreationRecord } from '../../domain/entities/offer-creation-record.entity';

export interface EnqueueOfferCreationInput {
  /** OL internal variant id being listed. */
  internalVariantId: string;
  /** Target marketplace connection id. */
  connectionId: string;
  /** Offered stock quantity. */
  stock: number;
  /** Publish immediately after creation (false = create as draft). */
  publishImmediately: boolean;
  /** Optional explicit price; when omitted the builder falls back to master product. */
  price?: { amount: number; currency: string };
  /** Optional overrides; the builder strips null/undefined on the worker side. */
  overrides?: CreateOfferOverrides;
  /** Caller-supplied idempotency key; defaults to `offer-create:{record.id}` (per-call-unique). */
  idempotencyKey?: string;
  /**
   * Parent BulkListingBatch id when this enqueue is part of a bulk
   * submission (#736). When set the emitted job payload is
   * `MarketplaceOfferCreatePayloadV2` (carries `bulkBatchId` +
   * `generateDescription` + optional `descriptionTone`); when omitted, V1
   * is emitted unchanged so the single-offer flow is byte-identical to
   * pre-#736 behavior.
   */
  bulkBatchId?: string;
  /**
   * Bulk flag: operator wants the worker handler (#737) to generate the
   * offer description via the AI prompt template. Ignored when
   * `bulkBatchId` is unset (single-offer flow has no AI integration in v1).
   */
  generateDescription?: boolean;
  /**
   * Optional tone hint forwarded to the AI prompt template. Ignored when
   * `generateDescription` is false or `bulkBatchId` is unset.
   */
  descriptionTone?: OfferDescriptionTone;
}

export interface EnqueueOfferCreationResult {
  /** Redis Streams message id of the enqueued job. */
  jobId: string;
  /** Pre-created record visible before the worker runs. */
  offerCreationRecord: OfferCreationRecord;
}
