/**
 * Sync Job Types
 *
 * Defines types for sync job requests. Jobs are enqueued to Redis Streams
 * and consumed by workers to trigger synchronization operations.
 *
 * @module libs/core/src/sync/domain/types
 */

/**
 * Job Type Values
 *
 * Runtime array of all valid job type values. Used for validation,
 * Swagger documentation, and UI dropdowns.
 */
export const JobTypeValues = [
  // Generic (Option B)
  'marketplace.orders.poll',
  'marketplace.order.sync',
  // Per-order reporting-currency stamp: bounded retry after a degraded inline
  // attempt, plus the hourly reconcile that survives a dead retry job (#2125).
  // Named under `marketplace.order.*` rather than a new `order.*` namespace so
  // it greps alongside `marketplace.order.sync`, which ingests the same row.
  'marketplace.order.fxStamp',
  'marketplace.order.fxStampSweep',
  'marketplace.offers.sync',
  'marketplace.offerQuantity.update',
  'marketplace.offer.updateFields',
  'marketplace.offer.create',
  'marketplace.offer.pollCreationStatus',
  'marketplace.offer.statusSync',
  'marketplace.offer.refreshSnapshot',
  'marketplace.offer.stockRestore',
  // Stale-variant offer pause: trigger (event-driven) and sweep (reconcile) (#1689).
  'marketplace.offer.pauseStale',
  'marketplace.offer.pauseStaleSweep',
  'marketplace.shipment.statusSync',
  'marketplace.shipment.syncByExternalId',
  'marketplace.fulfillment.statusSync',
  'master.product.syncByExternalId',
  'master.product.syncAll',
  // Incremental catalog pass (#2220, ADR-048). Opt-in; complements rather than
  // replaces `syncAll`, which remains the reconciliation/bootstrap path.
  'master.product.syncDelta',
  // Deletion reconciliation (#2222, ADR-048 decision 2). Enumerates OL's OWN
  // product mappings and re-checks each by id, so the adapter's 404 is the
  // authority — never inference from absence in a catalog enumeration.
  'master.product.reconcile',
  'master.inventory.syncByExternalId',
  'master.inventory.syncAll',

  'master.variants.autoMatch',

  // Shop (cross-platform listing, ADR-024; executed by worker)
  'shop.product.publish',
  // Steady-state shop product-status reconcile (#1845).
  'shop.product.statusSync',

  // Shipping (core-owned; capability-scoped, executed by worker)
  'shipping.pickupPoint.refreshFrequent',

  // Invoicing (core-owned; capability-scoped, executed by worker)
  // KSeF regulatory-status reconciliation sweep (#1121).
  'invoicing.regulatoryStatus.reconcile',
  // By-id payment-status refresh triggered by a provider payment webhook (#1354).
  'invoicing.paymentStatus.refreshByExternalId',
  // Degraded-mode offline-submission resubmission sweep (#1702).
  'invoicing.offlineSubmission.resubmit',
  // Crash-recovery sweep for invoices stuck mid-issuance (#1703).
  'invoicing.pendingRecovery.sweep',

  // Destination taxonomy projection refresh (core-owned; #1979, ADR-037).
  // Connection-scoped as an interim scaffold — the real subject is a taxonomy
  // owner, pending #1943 (`SyncJob.connectionId` nullability).
  'destination.taxonomy.sync',

  // Internal orchestration (core-owned policies; executed by worker)
  'inventory.propagateToMarketplaces',

  // Invoicing (core-owned policy; executed by worker — OL #1120)
  'invoicing.issue',

  // Fiscalization (core-owned policy; executed by worker — #2156, ADR-041 decision 7)
  'fiscalization.register',

  // Tax-rate backfill sweep for pre-#2245 order_line_items rows (#2440).
  // Connection-scoped for the same reason `marketplace.order.fxStampSweep` is:
  // the fact is connection-agnostic, but `SyncJob.connectionId` is
  // non-nullable, so the per-`OrderSource`-connection fan-out is also the
  // natural partition of the rate-less frontier.
  'orders.taxRate.backfill',
] as const;

/**
 * Job Type
 *
 * Derived union type from JobTypeValues. Provides type safety
 * without runtime overhead.
 */
export type JobType = (typeof JobTypeValues)[number];

/**
 * Job Status Values
 *
 * Runtime array of all valid job status values. Used for validation,
 * Swagger documentation, and UI dropdowns.
 */
export const JobStatusValues = ['queued', 'running', 'succeeded', 'dead'] as const;

/**
 * Job Status
 *
 * Derived union type from JobStatusValues. Provides type safety
 * without runtime overhead.
 */
export type JobStatus = (typeof JobStatusValues)[number];

/**
 * Job Outcome Values
 *
 * Runtime array of all valid job outcome values. Outcome is the *business*
 * result of a successfully-orchestrated job — distinct from `status`, which
 * is the orchestration result. Set only when a job reaches `succeeded`;
 * `null` for queued / running / dead jobs (no business outcome to record).
 *
 * - `'ok'`: business operation succeeded.
 * - `'business_failure'`: orchestration ran cleanly but the business
 *   operation was rejected terminally (e.g. marketplace validation failed
 *   on `marketplace.offer.create`). Not retried by the runner.
 */
export const JobOutcomeValues = ['ok', 'business_failure'] as const;

/**
 * Job Outcome
 *
 * Derived union type from JobOutcomeValues.
 */
export type JobOutcome = (typeof JobOutcomeValues)[number];

/**
 * Job Outcome Reason Values
 *
 * Stable machine-readable codes for WHY a job reached a given `outcome` —
 * distinct from `outcome` itself (the business result). Extensible: other
 * `business_failure` producers add their own codes over time.
 *
 * - `'master_deleted'`: the source product/variant was deleted at its master
 *   (#1599) — `master.product.syncByExternalId` returns `business_failure`
 *   with this reason rather than retrying a permanent condition.
 */
export const JobOutcomeReasonValues = ['master_deleted'] as const;

/**
 * Job Outcome Reason
 *
 * Derived union type from JobOutcomeReasonValues.
 */
export type JobOutcomeReason = (typeof JobOutcomeReasonValues)[number];

/**
 * Sync Job Handler Result
 *
 * Returned by every `SyncJobHandler.execute` implementation on the success
 * (no-throw) path. Carries the *business* outcome of the run, threaded back
 * through the worker runner to `sync_jobs.outcome` (issue #400 — Plan B for
 * #391). Handlers without a meaningful business-failure branch return
 * `{ outcome: 'ok' }` unconditionally. `outcomeReason` is an optional stable
 * code further classifying WHY (e.g. `'master_deleted'`) — persisted
 * alongside `outcome` on the succeeded path (#1689).
 */
export interface SyncJobHandlerResult {
  outcome: JobOutcome;
  outcomeReason?: JobOutcomeReason;
}

/**
 * Enqueue Job Result
 *
 * Returned by JobEnqueuePort.enqueueJob. Separates the job ID from the
 * idempotency flag so callers do not need to parse string prefixes.
 */
export interface EnqueueJobResult {
  /** Job ID assigned by the queue (stream message ID or existing job ID) */
  jobId: string;
  /** True when the idempotency key matched an already-enqueued job */
  isExisting: boolean;
}

/**
 * Sync Job Request
 *
 * Represents a sync job request to be enqueued. Jobs are published to
 * Redis Streams and consumed by workers that trigger synchronization
 * operations via adapters.
 */
export interface SyncJobRequest {
  /**
   * Job type identifier (e.g., 'marketplace.orders.poll')
   */
  jobType: JobType;

  /**
   * Connection identifier (UUID)
   */
  connectionId: string;

  /**
   * Job payload (provider-specific data)
   */
  payload: Record<string, unknown>;

  /**
   * Idempotency key (required for deduplication)
   * Format: {provider}:{connectionId}:{eventId}
   */
  idempotencyKey: string;
}

/**
 * Sync Job Filters
 *
 * Criteria for querying sync jobs. All fields are optional — omitting a field
 * means no filter is applied for that dimension.
 */
export interface SyncJobFilters {
  status?: JobStatus;
  connectionId?: string;
  jobType?: JobType;
  outcome?: JobOutcome;
}

/**
 * Sync Job Pagination
 *
 * Offset-based pagination parameters for sync job list queries.
 */
export interface SyncJobPagination {
  /** Number of items to return (1–100) */
  limit: number;
  /** Number of items to skip */
  offset: number;
}

/**
 * Paginated Sync Jobs
 *
 * Result of a paginated sync job query.
 */
export interface PaginatedSyncJobs {
  items: SyncJob[];
  total: number;
}

/**
 * Sync Job Group
 *
 * Aggregated dead-job signature returned by the grouped-jobs endpoint.
 * Each group collapses all dead jobs with the same (connectionId, jobType)
 * into one row with a count, a representative job id, and the group's
 * most recent error message and update timestamp.
 */
export interface SyncJobGroup {
  connectionId: string;
  jobType: JobType;
  count: number;
  /** Most recent `updatedAt` across the group; drives sort order. */
  latestUpdatedAt: Date;
  /** ID of the most-recently-updated job in the group; powers Retry/View deep links. */
  representativeJobId: string;
  /** Last error from the representative row; usually shared across the group. */
  lastError: string | null;
}

/**
 * Sync Job Groups Result
 *
 * Result shape for `SyncJobRepositoryPort.findGroupedByStatus`. `groups`
 * is capped at the caller's `maxGroups`; `totalGroups` exposes the true
 * count so the UI can render "top N of M signatures".
 */
export interface SyncJobGroupsResult {
  groups: SyncJobGroup[];
  totalGroups: number;
  totalJobs: number;
}

/**
 * Sync Job Group Filters
 *
 * Filter criteria for `SyncJobRepositoryPort.findGroupedByStatus`.
 */
export interface SyncJobGroupFilters {
  status: JobStatus;
  connectionId?: string;
}

/**
 * Bulk Retry Result
 *
 * Result shape for `SyncJobRepositoryPort.requeueDeadJobsInGroup` and
 * `ISyncJobBulkRetryService.retryGroup`. `skipped` counts jobs that
 * flipped out of `dead` between our SELECT and UPDATE (another retry
 * raced us, or the worker picked them up).
 */
export interface BulkRetryResult {
  requeuedJobIds: string[];
  count: number;
  skipped: number;
}

/**
 * Maximum number of jobs to re-queue in a single bulk-retry call.
 * UIs that hit the cap can click Retry again to drain the rest.
 */
export const BULK_RETRY_MAX_BATCH_SIZE = 1000;

/**
 * Sync Job (Persisted)
 *
 * Represents a persisted sync job in the database. Extends SyncJobRequest
 * with persistence fields (id, status, attempts, etc.).
 */
export interface SyncJob extends SyncJobRequest {
  /**
   * Job ID (UUID)
   */
  id: string;

  /**
   * Job status
   */
  status: JobStatus;

  /**
   * Number of execution attempts
   */
  attempts: number;

  /**
   * Maximum number of attempts before marking as dead
   */
  maxAttempts: number;

  /**
   * Next run timestamp (for retries)
   */
  nextRunAt: Date | string;

  /**
   * Lock timestamp (when job was locked by worker)
   */
  lockedAt?: Date | string | null;

  /**
   * Worker instance ID that locked the job
   */
  lockedBy?: string | null;

  /**
   * Last error message (if job failed)
   */
  lastError?: string | null;

  /**
   * Business outcome of the job (only set on the succeeded path).
   *
   * - `'ok'`: business operation succeeded.
   * - `'business_failure'`: orchestration succeeded but the business
   *   operation was rejected terminally (e.g. marketplace validation failed).
   * - `null`: job has not reached `succeeded` (queued / running / dead),
   *   or this is a historical row predating the outcome column (#400).
   */
  outcome?: JobOutcome | null;

  /**
   * Stable machine-readable reason further classifying `outcome` (#1689).
   * `null`/absent when the outcome needs no finer classification, or for
   * historical rows predating the column.
   */
  outcomeReason?: JobOutcomeReason | null;

  /**
   * Creation timestamp
   */
  createdAt: Date | string;

  /**
   * Last update timestamp
   */
  updatedAt: Date | string;
}
