/**
 * Marketplace Job Payload Types (Generic)
 *
 * Canonical payload schemas for marketplace.* sync jobs.
 *
 * @module libs/core/src/sync/domain/types
 */

import type { CreateOfferOverrides, OfferFieldUpdate } from '@openlinker/core/listings';
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
  fields: OfferFieldUpdate;
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
 * Bulk-aware payload for `marketplace.offer.create` jobs (#736).
 *
 * Extends V1 with bulk-batch attribution + the AI-description toggles the
 * bulk wizard surfaces. The worker handler change that consumes
 * `bulkBatchId` (incrementing batch counters on terminal status) lands in
 * **#737**; this PR defines the wire shape and emits V2 from the bulk
 * submission service. Single-offer flows keep emitting V1.
 *
 * Connection id still comes from `job.connectionId`, not the payload.
 */
export interface MarketplaceOfferCreatePayloadV2 {
  schemaVersion: 2;
  /** OL internal variant id being listed. */
  internalVariantId: string;
  /** Offered stock quantity. */
  stock: number;
  /** Publish immediately after creation. */
  publishImmediately: boolean;
  /** Optional explicit price; when omitted the builder falls back to master product. */
  price?: { amount: number; currency: string };
  /** Optional overrides — same shape as V1. */
  overrides?: CreateOfferOverrides;
  /** Optional idempotency key forwarded to the adapter. */
  idempotencyKey?: string;
  /** Pre-created OfferCreationRecord id — always set for V2 (bulk pre-creates). */
  offerCreationRecordId: string;
  /**
   * Parent BulkListingBatch id. The worker handler (#737) uses this
   * to call `BulkListingBatchRepositoryPort.incrementCounters` after
   * terminal status, and the bulk service uses it as part of the
   * idempotency key (`bulk:{batchId}:variant:{variantId}`).
   */
  bulkBatchId: string;
  /**
   * Operator opted into AI description generation for this batch. The
   * worker handler (#737) routes a generated description into `overrides`
   * when true.
   */
  generateDescription: boolean;
  /**
   * Optional tone hint forwarded to the AI prompt template. Ignored when
   * `generateDescription` is false.
   */
  descriptionTone?: OfferDescriptionTone;
}

/**
 * AI-description tone hint surfaced by the bulk wizard (#736 / #737).
 *
 * `as const` + union per engineering standards. Adding a new tone requires
 * editing both the values array and the prompt-template register on the
 * worker side (#737).
 */
export const OfferDescriptionToneValues = ['concise', 'detailed'] as const;

export type OfferDescriptionTone = (typeof OfferDescriptionToneValues)[number];

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

/**
 * Payload for `marketplace.offer.statusSync` jobs (#816).
 *
 * Steady-state refresh of the live marketplace publication status for offers
 * already mapped to internal variants — distinct from
 * `marketplace.offer.pollCreationStatus` (#447), which follows a single
 * freshly-created offer through `validating → active|draft` and writes
 * `OfferCreationRecord`. This job reads every mapped offer's status and
 * persists it into `offer_status_snapshots`; the two never write the same row.
 *
 * Enumeration is paced by a numeric **scan offset** persisted on the
 * connection cursor (`cursorKey`, default `allegro.offerStatus.scanOffset`):
 * each run refreshes the next `limit` offers ordered by the offer-mapping
 * repository, advancing the offset and wrapping to `0` at the end of the
 * catalog. There is no marketplace cursor — Allegro exposes no bulk status
 * endpoint, so the work list is OL's own offer mappings.
 */
export interface MarketplaceOfferStatusSyncPayloadV1 {
  schemaVersion: 1;
  /** Page size: number of mapped offers to refresh per run. */
  limit: number;
  /**
   * Connection-cursor key under which the rolling numeric scan offset is
   * persisted. Omitted → the handler falls back to
   * `allegro.offerStatus.scanOffset`.
   */
  cursorKey?: string;
}

/**
 * Payload for `marketplace.offer.stockRestore` jobs (#1146).
 *
 * Enqueued by the `OrderIngestionService` cancellation-observe hook when an
 * order transitions to `cancelled`. The worker handler delegates to the core
 * `OfferStockRestoreService`, which loads the order's resolved variant ids,
 * resolves their distinct external offer ids + absolute master-inventory
 * targets, and issues the destination marketplace's stock-restore (capability
 * `OfferStockRestorer`). Connection id comes from `job.connectionId` (the
 * order's source marketplace), not the payload.
 */
export interface MarketplaceOfferStockRestorePayloadV1 {
  schemaVersion: 1;
  /** OL internal order id whose cancellation triggers the stock restore. */
  internalOrderId: string;
}

/**
 * Payload v1 — Marketplace Shipment Status Sync (#838)
 *
 * Cursor-paced refresh of non-terminal `Shipment` rows for one carrier
 * (`ShippingProviderManager`) connection. The handler reads each shipment's
 * current carrier state via the connection's `getTracking` and projects
 * terminal status + carrier-waybill backfill onto OL's `Shipment` row,
 * propagating any newly-arrived tracking number to the destination OMP via
 * capability B (`OrderFulfillmentUpdater`).
 *
 * Mirrors `MarketplaceOfferStatusSyncPayloadV1` (#816): there's no carrier
 * cursor, so the work-list is OL's own `Shipment` rows paged by a rolling
 * scan offset persisted on `connection_cursors` (default
 * `allegro.shipmentStatus.scanOffset`).
 */
export interface MarketplaceShipmentStatusSyncPayloadV1 {
  schemaVersion: 1;
  /** Page size: number of non-terminal shipments to refresh per run. */
  limit: number;
  /**
   * Connection-cursor key under which the rolling numeric scan offset is
   * persisted. Omitted → the handler falls back to
   * `allegro.shipmentStatus.scanOffset`.
   */
  cursorKey?: string;
}

/**
 * marketplace.shipment.syncByExternalId (#768, ADR-021)
 *
 * Parcel-targeted shipment refresh — the **trigger** half of the InPost
 * webhook flow. An inbound `Shipment.Tracking` webhook routes here (via the
 * `shipment` inbound domain) carrying the carrier's own parcel id; the handler
 * re-reads authoritative status via the connection's `getTracking` and
 * propagates terminal status + waybill to the destination OMP — the same
 * per-shipment primitive the paged `marketplace.shipment.statusSync` poll
 * (#838) uses, just keyed to one parcel instead of a rolling scan. The webhook
 * payload's own status is never trusted (sandbox-gated catalogue); the re-read
 * is the source of truth. `externalId` is the carrier `providerShipmentId`; the
 * job's connection scope resolves the shipment (cross-connection-guarded).
 */
export interface MarketplaceShipmentSyncByExternalIdPayloadV1 {
  schemaVersion: 1;
  /** Carrier-native parcel id (`providerShipmentId`) to refresh. */
  externalId: string;
}

/**
 * marketplace.fulfillment.statusSync (#834)
 *
 * Branch-1 (OMP-fulfilled) shipment status read-back. The handler pages OL
 * Order Records mirrored to this OMP connection, reads each one's
 * PrestaShop state via the `FulfillmentStatusReader` capability, and
 * projects branch-1 `Shipment` rows. Mirrors
 * `MarketplaceShipmentStatusSyncPayloadV1` in shape — both are rolling
 * scan-offset polls — but disjoint in scope (branch-1 vs branches 2/3).
 *
 * Cursor key default (when omitted) is
 * `prestashop.fulfillmentStatus.scanOffset`.
 */
export interface MarketplaceFulfillmentStatusSyncPayloadV1 {
  schemaVersion: 1;
  /** Page size: number of OrderRecords to scan per run. */
  limit: number;
  /**
   * Connection-cursor key under which the rolling numeric scan offset is
   * persisted. Omitted → the handler falls back to
   * `prestashop.fulfillmentStatus.scanOffset`.
   */
  cursorKey?: string;
  /**
   * Iteration-window bound (days). Records whose `updatedAt` is older than
   * this many days are skipped. Defaults to `DEFAULT_UPDATED_SINCE_DAYS` (30)
   * inside the service when omitted.
   */
  updatedSinceDays?: number;
}
