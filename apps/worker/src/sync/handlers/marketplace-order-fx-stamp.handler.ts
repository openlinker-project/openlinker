/**
 * Marketplace Order FX Stamp Handler (#2125, ADR-040)
 *
 * Thin delegate for jobs of type `marketplace.order.fxStamp` - the bounded retry
 * after an inline stamp attempt degraded. Re-enters the same
 * `IOrderFxStampService.stamp(internalOrderId)` the ingestion path calls, so the
 * two can never disagree; idempotent by construction, because `stampFxIfAbsent`
 * no-ops on a row that already carries a figure.
 *
 * ADR-007 outcome mapping, and the three arms are deliberately different:
 *
 *  - `stamped` (including already-stamped) -> `outcome: 'ok'`. A re-delivered
 *    job for an order somebody else already stamped is a success, not a failure.
 *  - `terminal` -> `outcome: 'business_failure'`. No `placedAt`, an unsupported
 *    pair or an unregistered source cannot be changed by retrying, and the
 *    runner's ten attempts would be ten futile provider round-trips.
 *  - `deferred` -> THROW, so the runner retries with backoff. The service has
 *    already enqueued nothing new (this job IS the retry), so returning `'ok'`
 *    here would silently drop the order.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
  MarketplaceOrderFxStampPayloadV1,
} from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import { IOrderFxStampService } from '@openlinker/core/orders';
import { ORDER_FX_STAMP_SERVICE_TOKEN } from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

@Injectable()
export class MarketplaceOrderFxStampHandler implements SyncJobHandler {
  private readonly logger = new Logger(MarketplaceOrderFxStampHandler.name);

  constructor(
    @Inject(ORDER_FX_STAMP_SERVICE_TOKEN)
    private readonly fxStamp: IOrderFxStampService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);

    this.logger.debug(
      `Executing marketplace.order.fxStamp job ${job.id} for order ${payload.internalOrderId}`
    );

    // `stamp` never throws - every failure arrives as an outcome - so there is
    // deliberately no try/catch wrapping it. A throw escaping the switch below
    // would be a contract violation of the service, and swallowing it here
    // would hide that.
    const outcome = await this.fxStamp.stamp(payload.internalOrderId);

    switch (outcome.kind) {
      case 'stamped':
        this.logger.log(
          `FX stamp ${outcome.alreadyStamped ? 'already present' : 'applied'} for order ` +
            `${payload.internalOrderId}: ${outcome.reportingTotalAmount} ${outcome.reportingCurrency}`
        );
        return { outcome: 'ok' };

      case 'terminal':
        this.logger.warn(
          `FX stamp permanently unavailable for order ${payload.internalOrderId}: ` +
            `reason=${outcome.reason}`
        );
        return { outcome: 'business_failure' };

      case 'deferred':
        throw new SyncJobExecutionError(
          `FX stamp still unavailable for order ${payload.internalOrderId}: ${outcome.reason}`,
          job.id,
          job.jobType,
          job.connectionId
        );
    }
  }

  private getPayload(job: SyncJob): MarketplaceOrderFxStampPayloadV1 {
    const payload = job.payload as Partial<MarketplaceOrderFxStampPayloadV1> | undefined;

    if (
      payload === null ||
      typeof payload !== 'object' ||
      payload.schemaVersion !== 1 ||
      typeof payload.internalOrderId !== 'string' ||
      payload.internalOrderId === ''
    ) {
      throw new SyncJobExecutionError(
        `Invalid marketplace.order.fxStamp payload: expected an object with schemaVersion=1 and a non-empty internalOrderId`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }

    return { schemaVersion: 1, internalOrderId: payload.internalOrderId };
  }
}
