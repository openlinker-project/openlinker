/**
 * Marketplace Job Payload Types (Generic)
 *
 * Canonical payload schemas for marketplace.* sync jobs.
 *
 * @module libs/core/src/sync/domain/types
 */

import type { CreateOfferOverrides } from '@openlinker/core/listings';
import type { OrderFeedEventType } from '@openlinker/core/orders';

export interface MarketplaceOrdersPollPayloadV1 {
  schemaVersion: 1;
  cursorKey: string;
  limit: number;
  eventTypes?: OrderFeedEventType[];
}

export interface MarketplaceOrderSyncPayloadV1 {
  schemaVersion: 1;
  externalOrderId: string;
  /**
   * Source event identifier for traceability/idempotency (typically feedItem.eventKey).
   */
  sourceEventId?: string;
  /**
   * Optional metadata from the feed item (useful for debugging/observability).
   */
  eventKey?: string;
  occurredAt?: string;
  eventType?: OrderFeedEventType;
}

export interface MarketplaceOfferQuantityUpdatePayloadV1 {
  schemaVersion: 1;
  offerId: string;
  quantity: number;
  idempotencyKey?: string;
}

export interface MarketplaceOfferFieldUpdatePayloadV1 {
  schemaVersion: 1;
  /** Internal OpenLinker offer ID (resolved to external ID by the handler). */
  offerId: string;
  fields: import('@openlinker/core/listings').OfferFieldUpdate;
  idempotencyKey?: string;
}

export interface MarketplaceOffersSyncPayloadV1 {
  schemaVersion: 1;
  limit: number;
  cursor?: string | null;
  cursorKey?: string;
  feedType?: 'offers' | 'events';
  masterConnectionId?: string | null;
}

/**
 * Payload for `marketplace.offer.create` jobs.
 *
 * Connection id is taken from `job.connectionId`, not from the payload.
 *
 * `schemaVersion: 1` pins the contract. Future breaking changes bump
 * `schemaVersion`; handlers must accept all versions they have seen in
 * persisted jobs until the backlog is drained.
 */
export interface MarketplaceOfferCreatePayloadV1 {
  schemaVersion: 1;
  /** OL internal variant id being listed. */
  internalVariantId: string;
  /** Offered stock quantity. */
  stock: number;
  /** Publish immediately after creation. */
  publishImmediately: boolean;
  /** Optional explicit price; when omitted the builder falls back to master product. */
  price?: { amount: number; currency: string };
  /**
   * Optional overrides (title, description, category, images, platformParams).
   *
   * Callers constructing this payload directly (e.g. the future
   * POST /listings/connections/:id/offers REST endpoint) should normalize
   * through `OfferBuilderService.buildCreateOfferCommand`, which strips
   * null/undefined fields from the overrides. Persisted payloads are not
   * expected to carry `null` description/imageUrls.
   */
  overrides?: CreateOfferOverrides;
  /** Optional idempotency key forwarded to the adapter. */
  idempotencyKey?: string;
  /**
   * Pre-created OfferCreationRecord id, if the caller (e.g. #259 REST endpoint)
   * wanted the record visible before the job ran. When omitted, the execution
   * service creates a fresh record with status='pending'.
   */
  offerCreationRecordId?: string;
}

/**
 * Payload for `marketplace.offer.pollCreationStatus` jobs (#447).
 *
 * Self-rescheduling poll: each iteration writes the next iteration's payload
 * with `pollAttempt + 1`. `pollAttempt` is the **polling-cadence** counter
 * (1..`OL_ALLEGRO_OFFER_POLL_MAX_ATTEMPTS`); orthogonal to `sync_jobs.attempts`,
 * which is the runner's transient-HTTP-retry counter (capped at 3 per
 * iteration). See `docs/plans/implementation-plan-447-allegro-offer-poll-creation-status.md`
 * §5.3 for the two-counter model.
 */
export interface MarketplaceOfferPollCreationStatusPayloadV1 {
  schemaVersion: 1;
  /** OL internal `OfferCreationRecord.id` to update on terminal states. */
  offerCreationRecordId: string;
  /** Marketplace-native offer id (e.g. Allegro `7781562863`). */
  externalOfferId: string;
  /**
   * Polling-cadence counter. `1` on the first scheduled poll; service writes
   * `pollAttempt + 1` into the next iteration's payload until terminal or
   * `OL_ALLEGRO_OFFER_POLL_MAX_ATTEMPTS` is reached.
   */
  pollAttempt: number;
}