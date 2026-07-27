/**
 * Master Product Sync All Handler
 *
 * Handles jobs of type 'master.product.syncAll'. Enumerates external product IDs
 * from the source platform via ProductMasterPort.listExternalIds and fans out
 * per-product 'master.product.syncByExternalId' sub-jobs. This is the catalog
 * discovery path — the mechanism by which OpenLinker learns about products that
 * exist on a freshly connected source platform but have no identifier mapping yet.
 *
 * Paginates through the source catalog until a short page is returned. Individual
 * sub-job enqueue failures are logged but do not fail the outer job (partial
 * fan-out is preferred over dropping the entire sweep). Only failure to enumerate
 * IDs (e.g. upstream API outage) propagates as a job failure.
 *
 * Sub-job idempotency key is derived from the outer job ID, so retries of the same
 * outer job produce the same sub-job keys and dedupe against the queue.
 *
 * @module apps/worker/src/sync/handlers
 */

import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
  SyncJobRequest,
} from '@openlinker/core/sync';
import { SyncJobExecutionError, JobEnqueuePort, JOB_ENQUEUE_TOKEN } from '@openlinker/core/sync';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import type { ProductMasterPort } from '@openlinker/core/products';
import { Logger } from '@openlinker/shared/logging';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';

type SyncJob = SyncJobEntity;

// 100 is the lowest common denominator across ProductMasterPort adapters —
// WooCommerce's REST API hard-caps `per_page` at 100 and rejects anything
// higher with a 400, so a larger default permanently fails WC master syncs
// (#1723). PrestaShop has no such cap; MAX_PAGES still bounds a full sweep
// at 100,000 products.
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGES = 1000; // Safety guard against infinite loops.

@Injectable()
export class MasterProductSyncAllHandler implements SyncJobHandler {
  private readonly logger = new Logger(MasterProductSyncAllHandler.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort,
    private readonly configService: ConfigService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    this.logger.log(
      `Executing master.product.syncAll job ${job.id} for connection ${job.connectionId}`
    );

    try {
      const productMaster = await this.integrationsService.getCapabilityAdapter<ProductMasterPort>(
        job.connectionId,
        'ProductMaster'
      );

      const pageSize = this.getPageSize();
      const externalIds = await this.collectExternalIds(productMaster, pageSize, job.connectionId);

      if (externalIds.length === 0) {
        this.logger.log(
          `No products found on source platform for connection ${job.connectionId}. Nothing to sync.`
        );
        return { outcome: 'ok' };
      }

      this.logger.log(
        `Discovered ${externalIds.length} product(s) on source for connection ${job.connectionId}. Fanning out sync jobs.`
      );

      const enqueuePromises = externalIds.map(async (externalId) => {
        const jobRequest: SyncJobRequest = {
          jobType: 'master.product.syncByExternalId',
          connectionId: job.connectionId,
          payload: {
            schemaVersion: 1,
            externalId,
            objectType: CORE_ENTITY_TYPE.Product,
          },
          idempotencyKey: `master:${job.connectionId}:product:sync:${externalId}:${job.id}`,
        };
        return this.jobEnqueue.enqueueJob(jobRequest);
      });

      const results = await Promise.allSettled(enqueuePromises);

      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected').length;

      if (failed > 0) {
        this.logger.warn(
          `master.product.syncAll for connection ${job.connectionId}: ${succeeded} enqueued, ${failed} failed`
        );
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            this.logger.error(
              `Failed to enqueue product sync for externalId ${externalIds[index]} (connection: ${job.connectionId}): ${String(result.reason)}`
            );
          }
        });
      } else {
        this.logger.log(
          `master.product.syncAll for connection ${job.connectionId}: ${succeeded} product sync job(s) enqueued`
        );
      }

      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `master.product.syncAll failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    }
  }

  private async collectExternalIds(
    productMaster: ProductMasterPort,
    pageSize: number,
    connectionId: string
  ): Promise<string[]> {
    const collected: string[] = [];
    let offset = 0;

    for (let page = 0; page < MAX_PAGES; page++) {
      const batch = await productMaster.listExternalIds({ limit: pageSize, offset });
      if (batch.length === 0) {
        break;
      }
      collected.push(...batch);
      if (batch.length < pageSize) {
        break;
      }
      offset += batch.length;
    }

    // Only true if every page returned was full — i.e., we never saw a short page
    // that would have terminated the loop naturally. Signals the guard truncated us.
    if (collected.length >= MAX_PAGES * pageSize) {
      this.logger.warn(
        `master.product.syncAll hit MAX_PAGES guard for connection ${connectionId}; pagination may be truncated`
      );
    }

    // De-duplicate defensively — some sources may repeat IDs across pages.
    return [...new Set(collected)];
  }

  private getPageSize(): number {
    const raw = this.configService.get<string>(
      'OL_PRODUCT_SYNC_PAGE_SIZE',
      String(DEFAULT_PAGE_SIZE)
    );
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PAGE_SIZE;
  }
}
