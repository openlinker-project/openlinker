/**
 * Marketplace Job Payload Types (Generic)
 *
 * Canonical payload schemas for marketplace.* sync jobs.
 *
 * @module libs/core/src/sync/domain/types
 */

import type { CreateOfferOverrides, OfferCondition, OfferFieldUpdate } from '@openlinker/core/listings';
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

/**
 * Payload for `marketplace.order.fxStamp` jobs (#2125, ADR-040).
 *
 * The bounded retry after an inline stamp attempt degraded (a rate provider
 * blip, a database hiccup). Carries ONLY the internal order id, because
 * `IOrderFxStampService.stamp` takes exactly that and rehydrates everything
 * else from the persisted record - a payload-carried `placedAt` or reporting
 * currency would let this path resolve differently from the inline one, which
 * is precisely what the persisted FX intent exists to prevent.
 *
 * Enqueued under the idempotency key `fx:{internalOrderId}`, so repeated inline
 * failures for one order collapse onto a single job.
 */
export interface MarketplaceOrderFxStampPayloadV1 {
  schemaVersion: 1;
  internalOrderId: string;
}

/**
 * Payload for `marketplace.order.fxStampSweep` jobs (#2125, ADR-040).
 *
 * The hourly reconcile, scheduled per `OrderSource`-capable connection - the
 * guarantee that survives a DEAD retry job. A job's idempotency key is globally
 * unique with no TTL and `createIfNotExistsByIdempotencyKey` returns the
 * existing row whatever its status, so once the ~4.3 h retry window is
 * exhausted that key can never be re-enqueued; a longer provider outage would
 * otherwise lose the stamp permanently. Reading the unstamped rows directly is
 * also the only mechanism that covers a retry job that was never enqueued.
 *
 * The handler selects on `fxStampedAt IS NULL AND reportingCurrency IS NULL`
 * for `job.connectionId`, bounded by `limit` and `maxAgeDays`.
 */
export interface MarketplaceOrderFxStampSweepPayloadV1 {
  schemaVersion: 1;
  /** Max unanswered orders to pull per sweep tick. */
  limit: number;
  /** Ignore orders created longer ago than this, in whole days. */
  maxAgeDays: number;
  /**
   * How long a TERMINAL answer is honoured before the sweep re-tries the order,
   * in whole days (#2135 review, finding 1).
   *
   * A terminal answer says "no retry changes this", which is true of the
   * classification and false of the world: `no-rate-source` clears when the host
   * is rewired, and an `unsupported-pair` raised by a throttled provider clears
   * on its own. Without a cooldown the row leaves the frontier forever and the
   * order silently never carries a reported figure. Only rows that still hold NO
   * figure are revisited - a real stamp is immutable and never re-entered.
   */
  terminalRetryDays?: number;
}

export interface MarketplaceOfferQuantityUpdatePayloadV1 {
  schemaVersion: 1;
  offerId: string;
  quantity: number;
  idempotencyKey?: string;
  /**
   * ISO-8601 observation token for the state this write expresses (#2285) — never
   * wall-clock `now()`. It both versions the derived idempotency key and orders
   * two concurrent writes for one offer (#2617). Optional, so a payload enqueued
   * before it existed stays valid and writes unguarded, exactly as before.
   */
  observedAt?: string;
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
  /**
   * Optional neutral item condition (#1500). Carried so a programmatic caller's
   * choice survives the enqueue → worker round-trip; the builder defaults it to
   * `'new'` when absent. The operator's wizard Stan choice rides on `overrides`
   * instead, so wizard payloads normally omit this.
   */
  condition?: OfferCondition;
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
  /** Optional neutral item condition (#1500) — same seam as V1. */
  condition?: OfferCondition;
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
 * Payload for `marketplace.offerQuantity.reconcile` jobs (#2621).
 *
 * Steady-state reconcile of a connection's outstanding asynchronously-
 * acknowledged quantity writes — mirrors `MarketplaceOfferStatusSyncPayloadV1`
 * in shape, but there is no scan offset: `limit` simply bounds how many
 * outstanding writes the adapter's own bookkeeping resolves per run, since
 * the pending-write set is adapter-internal and naturally shrinks as writes
 * terminalize.
 */
export interface MarketplaceOfferQuantityReconcilePayloadV1 {
  schemaVersion: 1;
  /** Max outstanding writes to reconcile per run. */
  limit: number;
}

/**
 * Payload for `marketplace.offer.refreshSnapshot` jobs (#1760).
 *
 * Post-terminal one-shot reconcile: the creation poller (#447) terminalises a
 * record to `draft` / `failed(POLL_TIMEOUT)` when Allegro's validator outran
 * the poll budget; Allegro may activate the offer minutes later. This bounded,
 * delayed job re-reads the live publication status (`OfferStatusReader`) and
 * upserts `offer_status_snapshots`, so the operator-facing live status (#816
 * read surface) reflects the late activation without waiting for the hourly
 * steady-state sync. The handler re-schedules `attempt + 1` (up to a small cap)
 * only while the offer is still not terminally published.
 *
 * Connection id comes from `job.connectionId`, not the payload.
 */
export interface MarketplaceOfferRefreshSnapshotPayloadV1 {
  schemaVersion: 1;
  /** Marketplace-native offer id to re-read (e.g. Allegro `7781896308`). */
  externalOfferId: string;
  /** Internal OL variant the offer is mapped to (carried for the snapshot upsert). */
  internalVariantId: string;
  /** Reconcile attempt, 1-based. The handler bounds re-scheduling by this. */
  attempt: number;
  /**
   * Identifies ONE reconcile chain (#2039). Minted when attempt 1 is scheduled
   * and carried through the handler's self-rescheduled follow-ups, so every
   * attempt of a chain has a deterministic idempotency key while two different
   * chains never collide.
   *
   * The pre-#2039 key was `refreshSnapshot:{externalOfferId}:{attempt}` against
   * a **globally unique, TTL-less** `sync_jobs.idempotencyKey`, so one offer id
   * could only ever receive one attempt-1 reconcile — across connections (an
   * Erli `externalOfferId` is the internal variant id, shared by every Erli
   * connection), across re-creates, and across retry waves.
   *
   * Optional on purpose: a job enqueued before this field existed can still be
   * in flight (rungs run up to +20 min out), and the handler falls back to the
   * legacy key shape for those rather than dead-lettering them.
   */
  reconcileId?: string;
}

/**
 * Delay (seconds) before reconcile `attempt` N runs, indexed by `attempt - 1`
 * (#1760): ~2 min, ~8 min, ~20 min. Chosen to comfortably outlast the ~9-min
 * creation-poll budget so a late Allegro activation is caught well before the
 * hourly steady-state sync. Length defines the attempt cap.
 */
export const OFFER_REFRESH_SNAPSHOT_DELAYS_SECONDS = [120, 480, 1200] as const;

/** Max reconcile attempts (#1760) — derived from the delay schedule length. */
export const OFFER_REFRESH_SNAPSHOT_MAX_ATTEMPTS = OFFER_REFRESH_SNAPSHOT_DELAYS_SECONDS.length;

/**
 * Idempotency key for one reconcile attempt (#2039).
 *
 * Lives beside the payload it keys because the chain has **two** writers — the
 * core poll service schedules attempt 1 and the worker handler self-schedules
 * the follow-ups — and a per-writer copy of the format would silently break the
 * chain's dedup the moment one side changed.
 *
 * `reconcileId` absent ⇒ the legacy `refreshSnapshot:{externalOfferId}:{attempt}`
 * shape, so a job enqueued before the field existed keeps rescheduling under the
 * key its own chain started with instead of dead-lettering mid-flight.
 */
export function buildOfferRefreshSnapshotIdempotencyKey(input: {
  connectionId: string;
  externalOfferId: string;
  attempt: number;
  reconcileId?: string;
}): string {
  if (input.reconcileId === undefined) {
    return `refreshSnapshot:${input.externalOfferId}:${input.attempt}`;
  }
  return `refreshSnapshot:${input.connectionId}:${input.reconcileId}:${input.attempt}`;
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
 * Payload for `marketplace.offer.pauseStale` jobs (#1689).
 *
 * Enqueued by the `events.master.deletion` stream consumer whenever a
 * `master.variant.stale` / `master.product.stale` event lands — the
 * event-driven trigger half of the stale-offer pause. Enqueued against the
 * sentinel system connection (the deletion is detected on the master
 * connection, but the offers to pause live on other connections), mirroring
 * `inventory.propagateToMarketplaces`. The worker handler delegates to the
 * core `StaleOfferPauseService`, which re-verifies each variant is still
 * `isStale` before zeroing its mapped offers (an event racing a reappearance
 * must never zero a live offer).
 */
export interface MarketplaceOfferPauseStalePayloadV1 {
  schemaVersion: 1;
  internalProductId: string;
  variantIds: string[];
  correlationId: string;
}

/**
 * Payload for `marketplace.offer.pauseStaleSweep` jobs (#1689).
 *
 * Scheduled hourly per `OfferManager`-capable connection — the reconcile
 * guarantee half of the stale-offer pause, closing the at-most-once gap left
 * by the event trigger (a lost/undelivered `events.master.deletion` message).
 * Pages stale-mapped variants for the job's own connection (`job.connectionId`)
 * via `OfferMappingRepositoryPort.findStaleMappedVariants` and re-asserts a
 * quantity-0 update for each still-stale one.
 */
export interface MarketplaceOfferPauseStaleSweepPayloadV1 {
  schemaVersion: 1;
  /** Max stale-mapped variants to page per sweep tick. */
  limit: number;
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
