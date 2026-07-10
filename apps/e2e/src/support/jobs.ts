/**
 * Sync-job trigger helpers
 *
 * Thin, typed wrappers over `POST /sync/jobs` for the checkpoints the golden
 * path drives explicitly (product sync, offer sync, order poll, inventory
 * propagation, invoice reconcile). `waitForJob` polls a job to a terminal state
 * so a checkpoint can be gated on the worker actually having run, rather than on
 * a fixed sleep.
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
  invoicingRegulatoryStatusReconcile: 'invoicing.regulatoryStatus.reconcile',
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

export class SyncJobs {
  constructor(private readonly api: ApiClient) {}

  /** Enqueue a sync job and return its id. */
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

  /** Poll a job by its `sync_jobs` row UUID until it reaches a terminal status. */
  async waitForJob(jobId: string, options: WaitForJobOptions = {}): Promise<SyncJob> {
    return pollUntil(
      () => this.api.syncJobs.getById(jobId),
      (job) => TERMINAL_STATUSES.has(job.status),
      {
        timeoutMs: options.timeoutMs ?? 60_000,
        intervalMs: options.intervalMs ?? 1_500,
        message: `sync job ${jobId} to reach a terminal status`,
      },
    );
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
      async () => {
        const page = await this.api.syncJobs.list({
          connectionId: input.connectionId,
          jobType: input.jobType,
          limit: 50,
        });
        return page.items.find((j) => j.idempotencyKey === input.idempotencyKey);
      },
      (j) => j !== undefined && TERMINAL_STATUSES.has(j.status),
      {
        timeoutMs: options.timeoutMs ?? 60_000,
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

  /** Propagate OL master inventory out to a marketplace's offers. */
  propagateInventory(connectionId: string): Promise<string> {
    return this.trigger({ connectionId, jobType: JobType.inventoryPropagateToMarketplaces });
  }
}
