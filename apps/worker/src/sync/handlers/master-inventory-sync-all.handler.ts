/**
 * Master Inventory Sync All Handler
 *
 * Handles jobs of type 'master.inventory.syncAll'. Enumerates all known product
 * external IDs for a connection and enqueues per-product 'master.inventory.syncByExternalId'
 * sub-jobs. Acts as a fan-out mechanism for periodic inventory synchronization.
 *
 * Fan-out resilience: individual sub-job enqueue failures are logged but do not
 * fail the outer job — partial fan-out is preferred over dropping the entire sweep.
 * Only failure to enumerate mappings (e.g., DB outage) propagates as a job failure.
 *
 * Sub-job idempotency key is derived from the outer job ID, so retries of the same
 * outer job produce the same sub-job keys and dedupe against the queue.
 *
 * @module apps/worker/src/sync/handlers
 */

import { Injectable, Inject } from '@nestjs/common';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
  SyncJobRequest,
} from '@openlinker/core/sync';
import { SyncJobExecutionError, JobEnqueuePort, JOB_ENQUEUE_TOKEN } from '@openlinker/core/sync';
import {
  IdentifierMappingQueryPort,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
} from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

@Injectable()
export class MasterInventorySyncAllHandler implements SyncJobHandler {
  private readonly logger = new Logger(MasterInventorySyncAllHandler.name);

  constructor(
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IdentifierMappingQueryPort,
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    this.logger.log(
      `Executing master.inventory.syncAll job ${job.id} for connection ${job.connectionId}`
    );

    try {
      const externalIds = await this.identifierMapping.listExternalIdsByConnection(
        'Product',
        job.connectionId
      );

      // Filter out synthetic variant external IDs (e.g. `product:13`).
      // These are created by the PrestaShop adapter as stable offer-link targets for
      // simple products; their internal ID is a variant ID, not a product ID, so
      // trying to insert inventory for them violates the inventory_items.productId FK.
      // Inventory for simple products is covered by the plain numeric externalId.
      const productExternalIds = externalIds.filter((id) => !id.startsWith('product:'));

      if (productExternalIds.length === 0) {
        this.logger.log(
          `No product mappings found for connection ${job.connectionId}. Skipping inventory sync.`
        );
        return { outcome: 'ok' };
      }

      this.logger.log(
        `Found ${productExternalIds.length} product(s) for connection ${job.connectionId}. Enqueuing inventory sync jobs.`
      );

      const enqueuePromises = productExternalIds.map(async (externalId) => {
        const jobRequest: SyncJobRequest = {
          jobType: 'master.inventory.syncByExternalId',
          connectionId: job.connectionId,
          payload: {
            schemaVersion: 1,
            externalId,
            objectType: 'Product',
          },
          // Derive from outer job id so retries of this outer job produce the same
          // sub-job keys and dedupe against the queue.
          idempotencyKey: `master:${job.connectionId}:inventory:sync:${externalId}:${job.id}`,
        };
        return this.jobEnqueue.enqueueJob(jobRequest);
      });

      const results = await Promise.allSettled(enqueuePromises);

      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected').length;

      if (failed > 0) {
        this.logger.warn(
          `master.inventory.syncAll for connection ${job.connectionId}: ${succeeded} enqueued, ${failed} failed`
        );
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            this.logger.error(
              `Failed to enqueue inventory sync for externalId ${productExternalIds[index]} (connection: ${job.connectionId}): ${String(result.reason)}`
            );
          }
        });
      } else {
        this.logger.log(
          `master.inventory.syncAll for connection ${job.connectionId}: ${succeeded} inventory sync job(s) enqueued (${externalIds.length - productExternalIds.length} synthetic variant IDs skipped)`
        );
      }

      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `master.inventory.syncAll failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    }
  }
}
