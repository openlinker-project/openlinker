/**
 * Sync-job trigger helpers
 *
 * Thin, typed wrappers over `POST /sync/jobs` for the checkpoints the golden
 * path drives explicitly (product sync, offer sync, order poll, inventory
 * propagation, invoice reconcile). `waitForJobByKey` polls a job to a terminal
 * state so a checkpoint can be gated on the worker actually having run, rather
 * than on a fixed sleep.
 *
 * @module support
 */
import { randomUUID } from 'node:crypto';
import type { ApiClient } from '../api/api-client';
import type { EnqueueSyncJobInput, SyncJob } from '../api/api.types';
import { pollUntil } from './poller';

/**
 * Canonical sync-job type identifiers (mirror of
 * `libs/core/src/sync/domain/types/sync-job.types.ts`). Only the values the E2E
 * flows enqueue are listed; extend as new checkpoints are automated.
 */
export const JobType = {
  masterProductSyncAll: 'master.product.syncAll',
  masterProductSyncByExternalId: 'master.product.syncByExternalId',
  masterInventorySyncAll: 'master.inventory.syncAll',
  marketplaceOffersSync: 'marketplace.offers.sync',
  marketplaceOrdersPoll: 'marketplace.orders.poll',
  inventoryPropagateToMarketplaces: 'inventory.propagateToMarketplaces',
  invoicingIssue: 'invoicing.issue',
  invoicingRegulatoryStatusReconcile: 'invoicing.regulatoryStatus.reconcile',
  marketplaceShipmentStatusSync: 'marketplace.shipment.statusSync',
  marketplaceFulfillmentStatusSync: 'marketplace.fulfillment.statusSync',
} as const;

export type JobTypeValue = (typeof JobType)[keyof typeof JobType];

const TERMINAL_STATUSES: ReadonlySet<SyncJob['status']> = new Set(['succeeded', 'dead']);

export interface WaitForJobOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

export interface TriggerAndWaitOptions extends WaitForJobOptions {
  /**
   * When true (default), throw if the job dies or succeeds with
   * `outcome: 'business_failure'` (ADR-007: orchestration ran but the business
   * operation was rejected terminally). Pass false to inspect the job yourself.
   */
  expectSuccess?: boolean;
}

/**
 * Default budget for a job to reach a terminal status.
 *
 * Dominated by QUEUE latency, not execution: a job waits behind everything the
 * stack's own schedulers already queued, and 163 s from enqueue to terminal was
 * measured on the shared demo stack while the queue drained. A budget below
 * that fails tests whose job is merely waiting its turn, so it is deliberately
 * well above the observed worst case.
 */
const DEFAULT_JOB_WAIT_MS = 300_000;

/**
 * Page size for the idempotency-key scan. 100 is the server maximum
 * (`ListSyncJobsQueryDto.limit` is `@Max(100)`), so this is the fewest possible
 * round-trips per poll tick.
 */
const JOB_SCAN_PAGE_SIZE = 100;

/**
 * Hard bound on how deep one scan pages before giving up for this tick. Without
 * it a connection with a large job backlog would turn every 1.5 s poll tick into
 * an unbounded fan of requests against the API under test.
 */
const JOB_SCAN_MAX_ROWS = 1_000;

export class SyncJobs {
  constructor(private readonly api: ApiClient) {}

  /** Mint the per-call unique dedup key the enqueue + wait pair share. */
  private mintKey(input: EnqueueSyncJobInput): string {
    return `e2e:${input.jobType}:${input.connectionId}:${randomUUID()}`;
  }

  /**
   * Enqueue a sync job and return the idempotency key that identifies it. The
   * API requires a `payload` object and an `idempotencyKey`; both are defaulted
   * here (empty payload + a per-call unique key).
   *
   * NOTE: the enqueue response's `jobId` is the Redis Stream ENTRY id (e.g.
   * `1783689833780-0`), NOT the `sync_jobs` row UUID — `GET /sync/jobs/:id`
   * rejects it with 400. The idempotency key is the only client-known handle
   * that survives intake, so that is what this returns and what the waiters
   * match on.
   */
  async trigger(input: EnqueueSyncJobInput): Promise<string> {
    const idempotencyKey = input.idempotencyKey ?? this.mintKey(input);
    await this.api.syncJobs.enqueue({
      ...input,
      payload: input.payload ?? {},
      idempotencyKey,
    });
    return idempotencyKey;
  }

  /**
   * Locate the row carrying `idempotencyKey`, or undefined while it does not
   * exist yet.
   *
   * The listing exposes no server-side `idempotencyKey` filter
   * (`ListSyncJobsQueryDto` accepts only status/connectionId/jobType/outcome),
   * so the key is matched client-side, and a single fixed window is not enough.
   * Rows come back newest-first (`sync-job.repository.ts`), and a fan-out
   * jobType can enqueue hundreds of siblings during the up-to-300 s wait, which
   * would push the target row out of the window mid-wait: the caller would then
   * time out with a message blaming the JOB when the failure was really the
   * LOOKUP. Paging removes that failure mode.
   */
  private async findJobByKey(input: {
    connectionId: string;
    jobType: string;
    idempotencyKey: string;
  }): Promise<SyncJob | undefined> {
    for (let offset = 0; offset < JOB_SCAN_MAX_ROWS; offset += JOB_SCAN_PAGE_SIZE) {
      const page = await this.api.syncJobs.list({
        connectionId: input.connectionId,
        jobType: input.jobType,
        limit: JOB_SCAN_PAGE_SIZE,
        offset,
      });
      const match = page.items.find((j) => j.idempotencyKey === input.idempotencyKey);
      if (match) return match;
      if (page.items.length < JOB_SCAN_PAGE_SIZE || offset + JOB_SCAN_PAGE_SIZE >= page.total) {
        return undefined;
      }
    }
    return undefined;
  }

  /**
   * Poll the jobs list for the row carrying `idempotencyKey` until it reaches a
   * terminal status. The row only exists after the intake consumer has drained
   * the stream entry, so "not found yet" is a normal transient state here.
   */
  async waitForJobByKey(
    input: { connectionId: string; jobType: string; idempotencyKey: string },
    options: WaitForJobOptions = {},
  ): Promise<SyncJob> {
    const job = await pollUntil<SyncJob | undefined>(
      () => this.findJobByKey(input),
      (j) => j !== undefined && TERMINAL_STATUSES.has(j.status),
      {
        timeoutMs: options.timeoutMs ?? DEFAULT_JOB_WAIT_MS,
        intervalMs: options.intervalMs ?? 1_500,
        message: `sync job ${input.jobType} (${input.idempotencyKey}) to reach a terminal status`,
      },
    );
    return job!;
  }

  /**
   * Enqueue a job and wait for it to reach a terminal status (matched by
   * idempotency key — see `trigger` for why the enqueue-returned id is unusable).
   *
   * A `succeeded` status alone is not a pass: the job may carry
   * `outcome: 'business_failure'` (status tracks orchestration, outcome tracks
   * the business result — ADR-007). By default both a dead job and a
   * business failure throw, with `lastError` surfaced in the message.
   */
  async triggerAndWait(
    input: EnqueueSyncJobInput,
    options: TriggerAndWaitOptions = {},
  ): Promise<SyncJob> {
    const idempotencyKey = input.idempotencyKey ?? this.mintKey(input);
    await this.trigger({ ...input, idempotencyKey });
    const job = await this.waitForJobByKey(
      { connectionId: input.connectionId, jobType: input.jobType, idempotencyKey },
      options,
    );
    if (options.expectSuccess !== false) {
      const failed = job.status !== 'succeeded' || job.outcome === 'business_failure';
      if (failed) {
        throw new Error(
          `sync job ${job.id} (${input.jobType}) finished with status=${job.status} ` +
            `outcome=${job.outcome ?? 'null'}${job.lastError ? `: ${job.lastError}` : ''}`,
        );
      }
    }
    return job;
  }

  /** Sync a marketplace/shop's master product catalogue into OL. */
  syncAllProducts(connectionId: string): Promise<string> {
    return this.trigger({ connectionId, jobType: JobType.masterProductSyncAll });
  }

  /** Refresh mapped marketplace offers for a connection. */
  syncMarketplaceOffers(connectionId: string): Promise<string> {
    return this.trigger({ connectionId, jobType: JobType.marketplaceOffersSync });
  }

  /** Poll a marketplace source for new/changed orders. */
  pollOrders(connectionId: string): Promise<string> {
    return this.trigger({ connectionId, jobType: JobType.marketplaceOrdersPoll });
  }

  /**
   * Build a `retriggerPoll` callback for `waitForOrderByExternalId` that
   * enqueues a direct `marketplace.order.sync` for ONE known
   * `externalOrderId` — the bypass for `marketplace.orders.poll`'s feed-listing
   * `date_upd` sort, which this PrestaShop version rejects outright (#2877).
   *
   * Deliberately RATE-LIMITED (at most once per `minIntervalMs`, default 30s)
   * rather than fired on every ~3s poll tick like the feed-poll retrigger it
   * replaces: unlike a feed poll (idempotent, cheap, re-reads a cursor), each
   * call here enqueues a NEW `sync_jobs` row with a fresh idempotency key —
   * firing it every tick for the whole wait window floods the `realtime` lane
   * with duplicates of the same job and can starve the one that would
   * actually resolve the wait (observed live: 188 queued duplicates from one
   * seed call before this existed).
   */
  retriggerDirectOrderSync(
    connectionId: string,
    externalOrderId: string,
    options: { minIntervalMs?: number } = {},
  ): () => Promise<unknown> {
    const minIntervalMs = options.minIntervalMs ?? 30_000;
    let lastTriggeredAt = 0;
    return async () => {
      const now = Date.now();
      if (now - lastTriggeredAt < minIntervalMs) return undefined;
      lastTriggeredAt = now;
      return this.trigger({
        connectionId,
        jobType: 'marketplace.order.sync',
        payload: {
          schemaVersion: 1,
          externalOrderId,
          // `matchesExternalOrderId` (orders.ts) keys on `sourceEventId`
          // starting with `{externalOrderId}:`, the shape the poll's feed
          // listing normally produces (`${externalOrderId}:${occurredAt}:${eventType}`).
          // A direct per-order sync carries no feed-derived eventKey, so one
          // is fabricated here purely as an identity token for the matcher.
          sourceEventId: `${externalOrderId}:e2e-direct-sync:${now}`,
        },
      });
    };
  }

  /**
   * Propagate OL master inventory out to every mapped marketplace offer of a
   * product/variant. The handler requires `productId` (+ optional `variantId`)
   * and fans out one quantity-update job per offer mapping across connections;
   * `connectionId` is only the enqueue anchor (any valid connection id).
   */
  propagateInventory(
    connectionId: string,
    target: { productId: string; variantId?: string },
  ): Promise<string> {
    return this.trigger({
      connectionId,
      jobType: JobType.inventoryPropagateToMarketplaces,
      payload: {
        productId: target.productId,
        variantId: target.variantId ?? null,
        inventoryUpdatedAt: new Date().toISOString(),
      },
    });
  }

  /** Refresh OL master inventory from a shop's stock. */
  syncAllInventory(connectionId: string): Promise<string> {
    return this.trigger({ connectionId, jobType: JobType.masterInventorySyncAll });
  }

  /**
   * Drive the branch-1 (OMP-fulfilled) `FulfillmentStatusReader` poll (#834):
   * pages OL Order Records mirrored to this connection, reads each one's
   * fulfillment status via the destination adapter, and projects a `Shipment`
   * row. `cursorKey` defaults to `prestashop.fulfillmentStatus.scanOffset`
   * server-side when omitted — the E2E caller always passes an explicit,
   * connection-scoped key so a WooCommerce run's rolling offset never
   * interleaves with PrestaShop's.
   */
  syncFulfillmentStatus(
    connectionId: string,
    options: TriggerAndWaitOptions & { cursorKey?: string; limit?: number } = {},
  ): Promise<SyncJob> {
    const { cursorKey, limit, ...triggerOptions } = options;
    return this.triggerAndWait(
      {
        connectionId,
        jobType: JobType.marketplaceFulfillmentStatusSync,
        payload: {
          schemaVersion: 1,
          limit: limit ?? 50,
          cursorKey: cursorKey ?? `e2e.${connectionId}.fulfillmentStatus.scanOffset`,
        },
      },
      { expectSuccess: false, ...triggerOptions },
    );
  }

  /** Reconcile a provider's regulatory (e.g. KSeF) clearance status into OL. */
  reconcileRegulatoryStatus(connectionId: string): Promise<string> {
    return this.trigger({ connectionId, jobType: JobType.invoicingRegulatoryStatusReconcile });
  }

  /**
   * Drive the carrier-generic shipment status poll (#838) that re-reads each
   * non-terminal shipment from the carrier and backfills its tracking number
   * onto the OL `Shipment` row. The ShipX sandbox mints the tracking number only
   * once the shipment is confirmed, so the golden path triggers this explicitly
   * rather than waiting on the 30-min `inpost-shipment-status-sync` cron.
   *
   * `expectSuccess` defaults to false: the poll is best-effort backfill and a
   * business failure on one page should not abort the caller's tracking wait.
   *
   * `cursorKey` is E2E-owned and connection-scoped, mirroring
   * `syncFulfillmentStatus`. Passing the production key
   * (`inpost.shipmentStatus.scanOffset`, from `inpost-scheduler-tasks.ts`) would
   * make every explicit test trigger ADVANCE the scheduled cron's rolling
   * offset, so the 30-min cron would skip whatever pages this run consumed.
   */
  syncShipmentStatus(
    connectionId: string,
    options: TriggerAndWaitOptions & { cursorKey?: string; limit?: number } = {},
  ): Promise<SyncJob> {
    const { cursorKey, limit, ...triggerOptions } = options;
    return this.triggerAndWait(
      {
        connectionId,
        jobType: JobType.marketplaceShipmentStatusSync,
        payload: {
          schemaVersion: 1,
          limit: limit ?? 50,
          cursorKey: cursorKey ?? `e2e.${connectionId}.shipmentStatus.scanOffset`,
        },
      },
      { expectSuccess: false, ...triggerOptions },
    );
  }
}
