/**
 * Sync Jobs Feature Types
 *
 * Frontend transport types for the sync jobs API. Mirrors the backend
 * SyncJobResponseDto contract. All date fields are ISO 8601 strings.
 *
 * @module apps/web/src/features/sync-jobs/api
 */

/**
 * Maximum page size accepted by the backend `GET /sync/jobs` endpoint.
 *
 * The server enforces `@Max(100)` in `apps/api/src/sync/http/dto/list-sync-jobs-query.dto.ts`
 * (and the same value on every other list DTO in the repo). Requesting `limit`
 * above this returns HTTP 400 with "limit must not be greater than 100".
 *
 * Keep this in sync with the backend validator. Any frontend caller that
 * pages through sync jobs should clamp to this value or lower.
 */
export const SYNC_JOBS_MAX_LIMIT = 100;

export const JOB_STATUS_VALUES = ['queued', 'running', 'succeeded', 'dead'] as const;
export type JobStatus = (typeof JOB_STATUS_VALUES)[number];

/**
 * Business outcome of a successfully-orchestrated job (issue #400 — Plan B
 * for #391). Distinct from `status`, which is the orchestration result.
 *
 * - `'ok'`: business operation succeeded.
 * - `'business_failure'`: orchestration ran cleanly but the business
 *   operation was rejected terminally (e.g. marketplace validation failed
 *   on `marketplace.offer.create`).
 *
 * `null` for queued / running / dead jobs and historical rows pre-dating
 * the column.
 */
export const JOB_OUTCOME_VALUES = ['ok', 'business_failure'] as const;
export type JobOutcome = (typeof JOB_OUTCOME_VALUES)[number];

/**
 * Stable machine-readable code further classifying `outcome` (#1689) —
 * distinct from `outcome` itself. `null`/absent when the outcome needs no
 * finer classification, or for historical rows predating the column.
 *
 * - `'master_deleted'`: the source product/variant was deleted at its master
 *   (#1599) — the master-product-sync job's `business_failure` was caused by
 *   this, distinguishing it from any other business failure.
 */
export const JOB_OUTCOME_REASON_VALUES = [
  'master_deleted',
  // Auto-dispatch (#3415) — six settled refusals that used to render as one
  // undifferentiated "business failure". Mirrors `JobOutcomeReasonValues` in
  // `@openlinker/core/sync`, which this bundle cannot import (#591).
  'auto_dispatch_payload_invalid',
  'auto_dispatch_not_enabled',
  'auto_dispatch_no_weight',
  'auto_dispatch_no_address',
  'auto_dispatch_no_delivery_method',
  'auto_dispatch_work_not_eligible',
  'auto_dispatch_shipment_claimed_by_sibling_work',
] as const;
export type JobOutcomeReason = (typeof JOB_OUTCOME_REASON_VALUES)[number];

/**
 * Every job type the API can report — the Jobs & Logs type filter's options.
 *
 * Mirrors `JobTypeValues` in `@openlinker/core/sync`, which this bundle cannot
 * import (#591). The two must hold the SAME set (order is free — this one is
 * grouped for the dropdown): a core type missing here is a job an operator
 * can see in the list but cannot filter to (#3507 G03-12 — `orders.export`
 * was absent, so the export dialog's "see it in Jobs & Logs" link landed on
 * an unfilterable type), and a value only here is a filter the API rejects.
 * `scripts/check-job-type-mirror.mjs` (`pnpm check:invariants`) enforces it.
 */
export const JOB_TYPE_VALUES = [
  'marketplace.orders.poll',
  'marketplace.order.sync',
  'marketplace.order.fxStamp', // Internal job — the bounded per-order reporting-currency stamp retry (#2125).
  'marketplace.order.fxStampSweep', // Internal job — the hourly reporting-currency stamp reconcile (#2125).
  'marketplace.returns.poll', // Returns discovery fan-out over the source feed (#2330).
  'marketplace.return.sync', // Internal job — the per-return hydrate child of the returns poll (#2330).
  'marketplace.returns.statusSync', // Internal job — re-reads OL's own non-terminal returns (#2330).
  'returns.orphan.reconcile', // Internal job — re-attributes orphan returns; no marketplace call (#2332).
  'automation.trigger.deadlineSweep', // Internal job — the time-based automation trigger (#2360).
  'marketplace.offers.sync',
  'marketplace.offerQuantity.update',
  'marketplace.offerQuantity.reconcile', // Internal job — confirms outstanding asynchronous quantity writes (#2621).
  'marketplace.offer.updateFields', // Internal job — not user-triggerable; listed here for status display only.
  'marketplace.offer.create',
  'marketplace.offer.pollCreationStatus', // Internal job — polls an asynchronous offer creation to its outcome.
  'marketplace.offer.statusSync', // Internal job — steady-state offer status reconcile.
  'marketplace.offer.refreshSnapshot', // Internal job — refreshes one offer's stored marketplace snapshot.
  'marketplace.offer.stockRestore', // Internal job — restores offer stock after a pause.
  'marketplace.shipment.statusSync', // Internal job — marketplace shipment status read-back.
  'marketplace.shipment.syncByExternalId', // Internal job — per-shipment sync by marketplace id.
  'marketplace.fulfillment.statusSync', // Internal job — marketplace fulfilment read-back (#834); NOT the OMS one below.
  'fulfillment.work.statusSync', // Internal job — OMS executor progress ingress (#2400).
  'fulfillment.work.dispatch', // Internal job — offers a routed fulfilment work to its holder (#2399).
  'fulfillment.work.autoDispatch', // Internal job — buys the shipping label on acceptance, when opted in (#3340).
  'fulfillment.work.route', // Internal job — commits where one order is fulfilled from (#2395).
  'fulfillment.work.timeoutSweep', // Internal job — reaps fulfilment work a holder never answered (#2712).
  'fulfillment.work.relaySweep', // Internal job — re-drives a missed dispatch relay (#2728).
  'master.product.syncAll',
  'master.product.syncDelta', // Internal job — not user-triggerable; listed here so an operator can filter the incremental pass (#2220).
  'master.product.reconcile', // Internal job — not user-triggerable; listed here so an operator can filter the deletion-reconciliation pass (#2222).
  'master.product.syncByExternalId',
  'master.product.syncFromSweep', // Internal job — the sweep-triggered per-product child, listed so an operator can tell catalogue work apart from webhook work (#2594). Still the delta and deletion-reconcile child after #2593; the full sweep now enqueues master.product.syncBatch.
  'master.product.syncBatch', // Internal job - not user-triggerable; listed here so an operator can filter the batched catalogue pass (#2593).
  'master.inventory.syncAll',
  'master.inventory.syncByExternalId',
  'master.inventory.syncFromSweep', // Internal job — sweep-triggered per-product inventory child (#2594). Still the per-product fallback for a failed batch member after #2648.
  'master.inventory.syncBatch', // Internal job - not user-triggerable; listed here so an operator can filter the batched stock pass (#2648).
  'master.variants.autoMatch',
  'shop.product.publish', // Cross-platform shop listing publish (ADR-024).
  'shop.product.statusSync', // Internal job — steady-state shop product-status reconcile (#1845).
  'shipping.pickupPoint.refreshFrequent', // Internal job — pickup-point directory refresh.
  'invoicing.issue', // Internal job — issues one invoice (#1120).
  'invoicing.regulatoryStatus.reconcile', // Internal job — KSeF regulatory-status sweep (#1121).
  'invoicing.paymentStatus.refreshByExternalId', // Internal job — payment-status refresh from a provider webhook (#1354).
  'invoicing.offlineSubmission.resubmit', // Internal job — degraded-mode offline resubmission sweep (#1702).
  'invoicing.pendingRecovery.sweep', // Internal job — recovers invoices stuck mid-issuance (#1703).
  'fiscalization.register', // Internal job — fiscal registration of one sales document (#2156).
  'destination.taxonomy.sync', // Internal job — destination taxonomy projection refresh (#1979).
  'inventory.propagateToMarketplaces',
  'pricing.propagateToMarketplaces', // Internal job — propagates one accepted/automatic price change (#3144).
  'inventory.provenance.backfill', // Internal job — not user-triggerable; listed here so an operator can watch the one-time provenance backfill drain (#2317).
  'inventory.reservations.expire', // Internal job — reservation expiry sweep (#2346).
  'inventory.reservations.consume', // Internal job — closes reservations once an order shipped (#2347).
  'inventory.reservations.shortfall', // Internal job — names orders a stock drop puts at risk (#2349).
  'orders.holds.reconcile', // Internal job — repairs the active-hold cache (#2340).
  'orders.taxRate.backfill', // Internal job — tax-rate backfill for older order lines (#2440).
  'orders.export', // Orders CSV/XLSX export run (#3534) — the export dialog links here.
  'analytics.currency.recalculate', // Internal job — Data Coverage currency restatement (#2468).
  'shipping.shipment.notifyDispatched', // Tells the source marketplace a parcel left, with its waybill.
  'subiekt.bridge.reachabilitySweep', // Internal job — periodic Subiekt bridge probe (#3358).
  'marketplace.offer.pauseStale', // Internal job — not user-triggerable; listed here for status display only.
  'marketplace.offer.pauseStaleSweep',
] as const;
export type JobType = (typeof JOB_TYPE_VALUES)[number];

export interface SyncJob {
  id: string;
  jobType: string;
  connectionId: string;
  status: JobStatus;
  outcome: JobOutcome | null;
  outcomeReason?: JobOutcomeReason | null;
  attempts: number;
  maxAttempts: number;
  nextRunAt: string;
  lastError: string | null;
  payloadJson: Record<string, unknown> | null;
  idempotencyKey: string | null;
  lockedAt: string | null;
  lockedBy: string | null;
  /**
   * Milliseconds the most recently completed execution attempt took (#2611) -
   * one attempt, not a total across retries, and not queue wait. `null` when
   * no attempt has completed, when the job was killed without executing, or
   * for a row predating the column. Never render or aggregate it as zero.
   */
  lastAttemptDurationMs: number | null;
  deferredTotalMs: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SyncJobFilters {
  status?: JobStatus;
  connectionId?: string;
  jobType?: JobType;
  outcome?: JobOutcome;
}

export interface SyncJobPagination {
  limit?: number;
  offset?: number;
}

export interface PaginatedSyncJobs {
  items: SyncJob[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Aggregated dead-job signature from `GET /sync/jobs/grouped`. Each group
 * collapses all jobs sharing a `(connectionId, jobType)` signature into a
 * single row with a count, representative job id, and the group's last
 * error + most recent update time.
 */
export interface SyncJobGroup {
  connectionId: string;
  jobType: JobType;
  count: number;
  /** ISO 8601 string. */
  latestUpdatedAt: string;
  representativeJobId: string;
  lastError: string | null;
}

export interface SyncJobGroupsResponse {
  groups: SyncJobGroup[];
  totalGroups: number;
  totalJobs: number;
}

export interface SyncJobGroupsFilters {
  status: JobStatus;
  connectionId?: string;
  /** Max groups to return (server caps at 100). */
  limit?: number;
}

export interface RetryGroupedSyncJobsInput {
  connectionId: string;
  jobType: JobType;
}

export interface RetryGroupedSyncJobsResult {
  requeuedJobIds: string[];
  count: number;
  skipped: number;
}
