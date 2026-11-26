/**
 * Fulfillment Work Status Poll Handler
 *
 * Handles `fulfillment.work.statusPoll`: reads a POLLING holder's progress for
 * the work its connection accepted, so work an executor such as Amazon
 * Multi-Channel Fulfillment ships moves in OpenLinker with no webhook.
 *
 * Composition, not injection (ADR-053): the `fulfillment` context may not
 * resolve adapters or perform the dispatch relay, so this handler resolves the
 * connection's `FulfillmentExecutor` adapter, narrows it to
 * `FulfillmentStatusSource` and hands it to `IFulfillmentStatusPollService`,
 * then drives each reported `dispatch` intent through the shipment-first
 * `routeDispatch`. A relay that fails here is not lost:
 * `fulfillment.work.relaySweep` re-drives any shipped work whose relay never
 * landed. A `reroute` intent (the holder cancelled units) is logged only;
 * re-sourcing a shortfall is not wired for any executor yet.
 *
 * An executor without a status read is a configuration fact, so the job ends
 * as a business failure rather than retrying. A failed status read of one work
 * is counted by the service and read again on the next tick.
 *
 * Lane `bulk`: a cron-paced pass over work already accepted, each candidate a
 * holder read; nothing a buyer waits on in seconds.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  FULFILLMENT_STATUS_POLL_SERVICE_TOKEN,
  isFulfillmentStatusSource,
  type FulfillmentExecutorPort,
  type IFulfillmentStatusPollService,
} from '@openlinker/core/fulfillment';
import { INTEGRATIONS_SERVICE_TOKEN, type IIntegrationsService } from '@openlinker/core/integrations';
import {
  FULFILLMENT_WORK_DISPATCH_ROUTER_SERVICE_TOKEN,
  type IFulfillmentWorkDispatchRouterService,
} from '@openlinker/core/shipping';
import {
  SYNC_CURSORS_SERVICE_TOKEN,
  SyncJobExecutionError,
  type FulfillmentWorkStatusPollPayloadV1,
  type ISyncCursorsService,
  type SyncJobEntity as SyncJob,
  type SyncJobHandler,
  type SyncJobHandlerResult,
} from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

const DEFAULT_PAGE_LIMIT = 25;
const MAX_PAGE_LIMIT = 100;
const DEFAULT_CURSOR_KEY = 'fulfillment.statusPoll.offset';

@Injectable()
export class FulfillmentWorkStatusPollHandler implements SyncJobHandler {
  private readonly logger = new Logger(FulfillmentWorkStatusPollHandler.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
    @Inject(FULFILLMENT_STATUS_POLL_SERVICE_TOKEN)
    private readonly poll: IFulfillmentStatusPollService,
    @Inject(FULFILLMENT_WORK_DISPATCH_ROUTER_SERVICE_TOKEN)
    private readonly router: IFulfillmentWorkDispatchRouterService,
    @Inject(SYNC_CURSORS_SERVICE_TOKEN)
    private readonly cursors: ISyncCursorsService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = (job.payload ?? {}) as Partial<FulfillmentWorkStatusPollPayloadV1>;
    const limit = clampLimit(payload.pageLimit);
    const cursorKey =
      typeof payload.cursorKey === 'string' && payload.cursorKey !== ''
        ? payload.cursorKey
        : DEFAULT_CURSOR_KEY;

    try {
      const executor = await this.integrations.getCapabilityAdapter<FulfillmentExecutorPort>(
        job.connectionId,
        'FulfillmentExecutor'
      );
      if (!isFulfillmentStatusSource(executor)) {
        this.logger.warn(
          `fulfillment.work.statusPoll: connection ${job.connectionId} offers no status read`
        );
        return { outcome: 'business_failure' };
      }

      const offset = Number((await this.cursors.getCursor(job.connectionId, cursorKey)) ?? '0');
      const result = await this.poll.pollConnection({
        connectionId: job.connectionId,
        source: executor,
        limit,
        offset: Number.isFinite(offset) && offset > 0 ? offset : 0,
        now: new Date(),
      });
      await this.cursors.advanceCursor(job.connectionId, cursorKey, String(result.nextOffset));

      for (const intent of result.intents) {
        if (intent.kind === 'dispatch') {
          await this.relay(intent.workId);
        } else {
          this.logger.warn(
            `fulfillment.work.statusPoll: work ${intent.workId} came back short from ` +
              `${job.connectionId}; re-sourcing the shortfall is not wired, see the work in OpenLinker`
          );
        }
      }

      if (result.polled > 0) {
        this.logger.log(
          `fulfillment.work.statusPoll connection=${job.connectionId}: polled=${String(result.polled)} ` +
            `recorded=${String(result.recorded)} failed=${String(result.failed)}`
        );
      }
      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Fulfillment status poll failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    }
  }

  /** Best-effort: the relay sweep re-drives a shipped work whose relay did not land. */
  private async relay(workId: string): Promise<void> {
    try {
      await this.router.routeDispatch(workId);
    } catch (error) {
      this.logger.warn(
        `fulfillment.work.statusPoll: dispatch relay for work ${workId} failed, the relay sweep ` +
          `will retry it: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

function clampLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_PAGE_LIMIT;
  }
  return Math.min(MAX_PAGE_LIMIT, Math.trunc(value));
}
