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
  // Returns ingestion (#2330, ADR-060). THREE types, not two: a source that
  // reports returns carries no change feed for them, so discovery and lifecycle
  // are separate passes (SPIKE-2289 E7/E8) — the `master.product.syncAll` /
  // `master.product.reconcile` split applied to returns.
  //   - `.returns.poll`     — cursor-paged discovery fan-out over the source feed
  //   - `.return.sync`      — per-return hydrate + idempotent upsert (the child)
  //   - `.returns.statusSync` — bounded re-read of OL's own non-terminal returns
  'marketplace.returns.poll',
  'marketplace.return.sync',
  'marketplace.returns.statusSync',
  // Orphan re-attribution reconcile (#2332). Namespaced `returns.*` rather than
  // `marketplace.*` because, unlike the three above, it contacts NO marketplace: it
  // re-checks OL's own orphan returns against `identifier_mappings` and writes a local
  // column. The namespace is the honest signal of that.
  'returns.orphan.reconcile',
  // Automation v1 (#2360). The only time-based trigger mode; `edge` triggers
  // emit at their write site and need no job.
  'automation.trigger.deadlineSweep',
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
  // OMS fulfilment progress ingress (#2400, ADR-054).
  //
  // **NOT the same job as `marketplace.fulfillment.statusSync` one line above,
  // and the two must never be conflated.** That one is the shipping context's
  // branch-1 OMP read-back (#834, `MarketplaceFulfillmentStatusSyncHandler`,
  // `IFulfillmentStatusSyncService` from `@openlinker/core/shipping`) — a
  // marketplace telling us how IT fulfilled an order. This one is an executor
  // reporting progress on a `FulfillmentWork` OL's own router created. Reusing
  // the older name would have routed OMS traffic straight into the shipping
  // handler.
  //
  // Namespaced `fulfillment.work.*` on the core-owned-internal-pass precedent
  // set by `inventory.reservations.*` and `orders.holds.reconcile`, rather than
  // `marketplace.*`, because the trigger is an executor and not necessarily a
  // marketplace at all.
  'fulfillment.work.statusSync',
  'master.product.syncByExternalId',
  // The SAME work as `master.product.syncByExternalId`, reached from a sweep
  // instead of a webhook (#2594). It exists as its own type because the two
  // triggers have different costs of starvation, and ADR-050 declares a lane
  // per job type at handler registration: a webhook child is a single unit
  // someone waits on (`realtime`), while a sweep child arrives a budget wide
  // and an operator tolerates it being slow (`bulk`). Same payload, same
  // handler. Since #2593 the FULL product sweep enqueues page-sized
  // `master.product.syncBatch` children instead, but this type is still the
  // child of the delta pass and of the deletion-reconcile pass, and it is the
  // per-product fallback for a failed batch member.
  'master.product.syncFromSweep',
  // Batched catalogue read (#2593, ADR-048). One job, one page of products, one
  // adapter instance - so a master declaring the bulk-read rung hydrates the
  // page in a handful of requests instead of a handful per product. Same work
  // per product as `master.product.syncByExternalId`, which remains the
  // fallback for a failed page member and the deletion-reconcile child.
  // Registered in `bulk`, not `realtime`: it is a catalogue-sweep child, and
  // ADR-050 picks the lane by cost of starvation.
  'master.product.syncBatch',
  'master.product.syncAll',
  // Incremental catalog pass (#2220, ADR-048). Opt-in; complements rather than
  // replaces `syncAll`, which remains the reconciliation/bootstrap path.
  'master.product.syncDelta',
  // Deletion reconciliation (#2222, ADR-048 decision 2). Enumerates OL's OWN
  // product mappings and re-checks each by id, so the adapter's 404 is the
  // authority — never inference from absence in a catalog enumeration.
  'master.product.reconcile',
  'master.inventory.syncByExternalId',
  // Sweep-triggered twin of `master.inventory.syncByExternalId`, for the same
  // reason as the product pair above (#2594).
  'master.inventory.syncFromSweep',
  // Batched stock read (#2648, ADR-048). The inventory twin of
  // `master.product.syncBatch`: one job, one page of products, one adapter
  // instance - so a master declaring `BulkInventoryReader` reads the page's
  // stock in a handful of requests instead of a handful per product. Same work
  // per product as `master.inventory.syncByExternalId`, which remains the
  // fallback for a failed page member. Registered in `bulk`, not `realtime`:
  // it is a sweep child, and ADR-050 picks the lane by cost of starvation.
  'master.inventory.syncBatch',
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
  // Connection-provenance backfill (#2317, ADR-058 ladder step (ii)). Stamps the
  // `'legacy'` sentinel onto pre-#2314 `inventory_items` rows, one bounded page
  // per tick, until none remain. Deliberately NOT named `master.*`: it makes zero
  // platform calls and reads only OL's own table — `inventory.propagateToMarketplaces`
  // is the naming precedent for a core-owned internal pass.
  'inventory.provenance.backfill',
  // #2346 — the state-dependent reservation expiry sweep. Reads and writes only
  // OL's own ledger; no platform call.
  'inventory.reservations.expire',
  // #2347 — the reservation CONSUME sweep: closes an order's held reservations
  // once its shipment shipped, claimed at-most-once via
  // `Shipment.reservationConsumedAt`. Reads and writes only OL's own tables.
  'inventory.reservations.consume',
  // #2349 — the reservation SHORTFALL reconciler: names the orders a master's
  // stock drop puts at risk, as persisted episodes. Reads OL's own tables and
  // repairs nothing; no platform call.
  'inventory.reservations.shortfall',
  // Repairs the `order_records.activeHoldReason` cache against `order_holds`
  // (#2340). Deliberately NOT named `marketplace.*`: it makes zero platform
  // calls and reads only OL's own tables - `inventory.provenance.backfill` is
  // the naming precedent for a core-owned internal pass.
  'orders.holds.reconcile',

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

  // Fulfilment executor handshake (#2399, `W3a-10`, ADR-054). Offers ONE routed
  // `FulfillmentWork` to its assigned holder under a retry-stable idempotency
  // key. `connectionId` is the work's own `assignedConnectionId` — never a
  // synthetic id, which is #2609's defect exactly: a shared scope collapses
  // per-scope lane accounting for the whole installation.
  'fulfillment.work.dispatch',
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
   * Wall-clock milliseconds of the most recently COMPLETED attempt (#2611),
   * measured around the handler call, so it INCLUDES any time that attempt
   * spent waiting for a per-connection rate-limit slot - that wait is a real
   * cost of the job. One attempt, never a total across retries, and never the
   * time the job spent queued before it was claimed or in retry backoff.
   *
   * Written in the same UPDATE as the terminal status transition that ended
   * that attempt, so it always describes the same attempt as `status`,
   * `outcome` and `lastError`.
   *
   * `null` when no attempt has completed, when the job was killed without
   * executing, or for a row predating the column. Never read it as zero - an
   * aggregate that does understates every real duration.
   */
  lastAttemptDurationMs?: number | null;

  /**
   * Total milliseconds this job has been parked by penalty-free DEFERRALS
   * (#2613/#2617) - a destination throttling us, a destination that is
   * unavailable, or a write refused because a peer held the lock.
   *
   * A deferral does not consume a retry attempt, so without a running total
   * nothing could ever end the cycle: a destination answering 503 forever
   * would recycle the job for ever while the row read `queued`. This column
   * is that bound. Once the total would exceed the runner's budget the job
   * falls back to the ordinary retry ladder, so it can still reach `dead`.
   *
   * Accumulates the wait GRANTED, not wall clock, and is never reset - a job
   * lives through one execution lifetime, so a reset could only re-open the
   * cycle it exists to close. `null`/absent means the job has never been
   * deferred.
   */
  deferredTotalMs?: number | null;

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

/**
 * Extra columns a penalty-free requeue may write in the same UPDATE
 * (#2613/#2611).
 *
 * `lastAttemptDurationMs` is a tri-state on purpose: omitted leaves whatever
 * was recorded, a number records the attempt that just ran, and an explicit
 * `null` clears a stale number left by an earlier attempt.
 */
export interface PenaltyFreeRequeuePatch {
  readonly lastAttemptDurationMs?: number | null;
  readonly deferredTotalMs?: number;
}
