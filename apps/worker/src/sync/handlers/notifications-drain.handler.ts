/**
 * Notifications Drain Handler (#4179)
 *
 * Handles `marketplace.notifications.drain`: resolves the connection's
 * `OrderSource` adapter, narrows it to `InboundQueueReader`, and lets
 * `IInboundQueueDrainService` route what the queue holds. The job carries no
 * data; every notification becomes an ordinary sync job that re-reads the
 * entity from the platform.
 *
 * An adapter without a queue reader is a configuration fact, not a failure
 * that retrying fixes, so it ends the job as a business failure (ADR-007).
 * Any other error retries on the ordinary ladder; messages not acknowledged
 * stay on the queue and arrive again.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  INTEGRATIONS_SERVICE_TOKEN,
  isInboundQueueReader,
  type IIntegrationsService,
} from '@openlinker/core/integrations';
import {
  INBOUND_QUEUE_DRAIN_SERVICE_TOKEN,
  SyncJobExecutionError,
  type IInboundQueueDrainService,
  type MarketplaceNotificationsDrainPayloadV1,
  type SyncJobEntity as SyncJob,
  type SyncJobHandler,
  type SyncJobHandlerResult,
} from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

/** SQS returns at most 10 messages a call; larger requests are clamped by the adapter. */
const DEFAULT_MAX_MESSAGES = 10;

@Injectable()
export class NotificationsDrainHandler implements SyncJobHandler {
  private readonly logger = new Logger(NotificationsDrainHandler.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
    @Inject(INBOUND_QUEUE_DRAIN_SERVICE_TOKEN)
    private readonly drainService: IInboundQueueDrainService,
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = job.payload as unknown as Partial<MarketplaceNotificationsDrainPayloadV1> | null;
    const maxMessages =
      typeof payload?.maxMessages === 'number' && payload.maxMessages > 0 ? payload.maxMessages : DEFAULT_MAX_MESSAGES;

    try {
      const { connection, metadata } = await this.integrations.getAdapter(job.connectionId);
      const adapter = await this.integrations.getCapabilityAdapter<object>(job.connectionId, 'OrderSource');
      if (!isInboundQueueReader(adapter)) {
        this.logger.warn(
          `marketplace.notifications.drain: connection ${job.connectionId} has no inbound queue reader`,
        );
        return { outcome: 'business_failure' };
      }
      const result = await this.drainService.drain({
        connection,
        supportedCapabilities: metadata.supportedCapabilities,
        reader: adapter,
        maxMessages,
      });
      if (result.received > 0) {
        this.logger.log(
          `marketplace.notifications.drain connection=${job.connectionId}: received=${String(result.received)} ` +
            `enqueued=${String(result.enqueued)} ungated=${String(result.ungated)} ` +
            `unreadable=${String(result.unreadable)} retained=${String(result.retained)}`,
        );
      }
      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Notifications drain failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined,
      );
    }
  }
}
