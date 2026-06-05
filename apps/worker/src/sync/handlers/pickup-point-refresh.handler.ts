/**
 * Pickup-Point Refresh Handler (#849)
 *
 * Thin delegate for jobs of type `shipping.pickupPoint.refreshFrequent`.
 * Re-warms the most-frequently-queried pickup-point searches for one
 * connection via the core `PickupPointRefreshService` (which reads the top-N
 * queries and re-runs each, refreshing the per-point + result caches). The
 * scheduler fans this out daily, one job per ShippingProviderManager
 * connection; connections without a pickup-point finder no-op in the service.
 *
 * Mirrors the other shipping-backed worker handlers (e.g.
 * `MarketplaceShipmentStatusSyncHandler`, #838): thin, delegates to a core
 * service, wraps failures in `SyncJobExecutionError`.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
} from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import {
  IPickupPointRefreshService,
  PICKUP_POINT_REFRESH_SERVICE_TOKEN,
} from '@openlinker/core/shipping';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

@Injectable()
export class PickupPointRefreshHandler implements SyncJobHandler {
  private readonly logger = new Logger(PickupPointRefreshHandler.name);

  constructor(
    @Inject(PICKUP_POINT_REFRESH_SERVICE_TOKEN)
    private readonly refreshService: IPickupPointRefreshService,
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    this.logger.log(
      `Executing shipping.pickupPoint.refreshFrequent job ${job.id} for connection ${job.connectionId}`,
    );

    try {
      const result = await this.refreshService.refreshFrequentForConnection(job.connectionId);
      this.logger.log(
        `shipping.pickupPoint.refreshFrequent completed (connection=${job.connectionId}): refreshed=${result.refreshed}, failed=${result.failed}`,
      );
      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Pickup-point refresh failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined,
      );
    }
  }
}
