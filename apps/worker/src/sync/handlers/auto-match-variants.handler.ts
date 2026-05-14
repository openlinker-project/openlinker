/**
 * Auto-Match Variants Handler
 *
 * Thin delegate for jobs of type 'master.variants.autoMatch'. Delegates
 * variant-to-offer matching to core AutoMatchVariantOffersService.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Injectable, Inject } from '@nestjs/common';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
} from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import type { AutoMatchVariantsJobPayload } from '@openlinker/core/products';
import {
  IAutoMatchVariantOffersService,
  AUTO_MATCH_VARIANT_OFFERS_SERVICE_TOKEN,
} from '@openlinker/core/products';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

@Injectable()
export class AutoMatchVariantsHandler implements SyncJobHandler {
  private readonly logger = new Logger(AutoMatchVariantsHandler.name);

  constructor(
    @Inject(AUTO_MATCH_VARIANT_OFFERS_SERVICE_TOKEN)
    private readonly autoMatchService: IAutoMatchVariantOffersService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);

    this.logger.log(
      `Executing master.variants.autoMatch job ${job.id} for connection ${job.connectionId} (dryRun=${payload.dryRun ?? false})`
    );

    try {
      const result = await this.autoMatchService.autoMatch(job.connectionId, {
        dryRun: payload.dryRun,
      });

      this.logger.log(
        `Auto-match complete (job=${job.id}): matched=${result.matched}, skippedAmbiguous=${result.skippedAmbiguous}, skippedNoMatch=${result.skippedNoMatch}, errors=${result.errors.length}`
      );

      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Auto-match variants failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    }
  }

  private getPayload(job: SyncJob): AutoMatchVariantsJobPayload {
    const payload = job.payload as unknown as Partial<AutoMatchVariantsJobPayload>;
    if (!payload || typeof payload !== 'object') {
      throw new SyncJobExecutionError(
        `Missing payload for job: ${job.id}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    return {
      schemaVersion: 1,
      dryRun: payload.dryRun ?? false,
    };
  }
}
