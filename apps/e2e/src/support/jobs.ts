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

export class SyncJobs {
  constructor(private readonly api: ApiClient) {}

  /** Enqueue a sync job and return its id. */
  async trigger(input: EnqueueSyncJobInput): Promise<string> {
    const response = await this.api.syncJobs.enqueue({
      ...input,
      payload: input.payload ?? {},
      idempotencyKey:
        input.idempotencyKey ?? `e2e:${input.jobType}:${input.connectionId}:${randomUUID()}`,
    });
    return response.jobId;
  }

  /** Poll a job until it reaches a terminal status (`succeeded` or `dead`). */
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

  /** Enqueue a job and wait for it to reach a terminal status. */
  async triggerAndWait(
    input: EnqueueSyncJobInput,
    options: WaitForJobOptions = {},
  ): Promise<SyncJob> {
    const jobId = await this.trigger(input);
    return this.waitForJob(jobId, options);
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
