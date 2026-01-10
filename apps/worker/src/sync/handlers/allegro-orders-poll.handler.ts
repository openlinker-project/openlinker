/**
 * Allegro Orders Poll Handler
 *
 * Handles sync jobs of type 'allegro.orders.poll'. Polls Allegro's event journal
 * for new order events and enqueues individual order sync jobs for each event.
 * Updates cursor only after successful enqueue to ensure cursor safety.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Injectable, Inject } from '@nestjs/common';
import {
  SyncJobHandler,
  SyncJob as SyncJobEntity,
  SyncJobExecutionError,
  ConnectionCursorRepositoryPort,
  CONNECTION_CURSOR_REPOSITORY_TOKEN,
  JobEnqueuePort,
  JOB_ENQUEUE_TOKEN,
  AllegroOrdersPollPayload,
  SyncJobRequest,
  AllegroOrderSyncByCheckoutFormIdPayload,
} from '@openlinker/core/sync';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { MarketplaceIntegrationPort } from '@openlinker/core/listings';

type SyncJob = SyncJobEntity;
import {
  AllegroAuthenticationException,
  AllegroRateLimitException,
} from '@openlinker/integrations-allegro';
import { Logger } from '@openlinker/shared/logging';

/**
 * Allegro Orders Poll Handler
 *
 * Implements SyncJobHandler for 'allegro.orders.poll' jobs.
 * Workflow:
 * 1. Validate payload (cursorKey, limit)
 * 2. Load cursor from cursor store
 * 3. Resolve Marketplace adapter via IntegrationsService
 * 4. Call getOrders with cursor
 * 5. For each event, enqueue order sync job with idempotency key
 * 6. Update cursor only after all enqueues succeed (cursor safety)
 */
@Injectable()
export class AllegroOrdersPollHandler implements SyncJobHandler {
  private readonly logger = new Logger(AllegroOrdersPollHandler.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(CONNECTION_CURSOR_REPOSITORY_TOKEN)
    private readonly cursorRepository: ConnectionCursorRepositoryPort,
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort,
  ) {}

  async execute(job: SyncJob): Promise<void> {
    this.logger.log(
      `Executing Allegro orders poll job ${job.id} for connection ${job.connectionId}`,
    );

    try {
      // Step 1: Validate payload
      const payload = this.getPayload(job);

      // Step 2: Load cursor from cursor store
      const cursor = await this.cursorRepository.get(job.connectionId, payload.cursorKey);

      this.logger.debug(
        `Loaded cursor for ${payload.cursorKey}: ${cursor || 'none (first poll)'}`,
      );

      // Step 3: Resolve Marketplace adapter
      const marketplaceAdapter = await this.integrationsService.getCapabilityAdapter<MarketplaceIntegrationPort>(
        job.connectionId,
        'Marketplace',
      );

      // Step 4: Call getOrders with cursor
      const feedResponse = await marketplaceAdapter.getOrders({
        cursor: cursor || undefined,
        limit: payload.limit,
      });

      this.logger.debug(
        `Fetched ${feedResponse.items.length} order events (nextCursor: ${feedResponse.nextCursor})`,
      );

      // Step 5: Enqueue order sync jobs for each event
      const enqueuedJobs: string[] = [];
      for (const item of feedResponse.items) {
        try {
          const orderSyncPayload: AllegroOrderSyncByCheckoutFormIdPayload = {
            checkoutFormId: item.checkoutFormId,
            eventId: item.eventId,
          };

          const orderSyncJob: SyncJobRequest = {
            jobType: 'allegro.order.syncByCheckoutFormId',
            connectionId: job.connectionId,
            payload: orderSyncPayload as unknown as Record<string, unknown>,
            idempotencyKey: `allegro:${job.connectionId}:${item.eventId}`,
          };

          const jobId = await this.jobEnqueue.enqueueJob(orderSyncJob);
          enqueuedJobs.push(jobId);

          this.logger.debug(
            `Enqueued order sync job for checkout form ${item.checkoutFormId} (event: ${item.eventId})`,
          );
        } catch (enqueueError) {
          // If enqueue fails, we should not update cursor (cursor safety)
          // Fail the entire poll job to ensure cursor safety - cursor won't be updated,
          // so on retry we'll re-process the same events (idempotency keys prevent duplicates)
          this.logger.error(
            `Failed to enqueue order sync job for event ${item.eventId}: ${(enqueueError as Error).message}`,
            enqueueError,
          );
          // Re-throw to fail the poll job (cursor won't be updated, will retry)
          throw new SyncJobExecutionError(
            `Failed to enqueue order sync job for event ${item.eventId}: ${(enqueueError as Error).message}`,
            job.id,
            job.jobType,
            job.connectionId,
            enqueueError instanceof Error ? enqueueError : undefined,
          );
        }
      }

      // Step 6: Update cursor only after all enqueues succeed (cursor safety)
      // Note: Update cursor even if items array is empty - this advances past processed events
      // and prevents infinite loops when Allegro returns empty results for a cursor position
      if (feedResponse.nextCursor) {
        await this.cursorRepository.set(job.connectionId, payload.cursorKey, feedResponse.nextCursor);
        this.logger.debug(`Updated cursor ${payload.cursorKey} to ${feedResponse.nextCursor}`);
      } else if (feedResponse.items.length === 0) {
        // If no items and no nextCursor, log a warning (might indicate end of feed or API issue)
        this.logger.warn(
          `Empty feed response with no nextCursor - cursor not updated (connection: ${job.connectionId})`,
        );
      }

      this.logger.log(
        `Allegro orders poll completed for job ${job.id}: enqueued ${enqueuedJobs.length} order sync job(s)`,
      );
    } catch (error) {
      // Re-throw SyncJobExecutionError as-is (already wrapped)
      if (error instanceof SyncJobExecutionError) {
        throw error;
      }

      // Handle non-retryable errors (permanent failures)
      if (error instanceof AllegroAuthenticationException) {
        // Authentication failure (401) - requires manual intervention
        throw new SyncJobExecutionError(
          `Authentication failed: ${error.message} (connection: ${job.connectionId})`,
          job.id,
          job.jobType,
          job.connectionId,
          error,
        );
      }

      // Handle rate limit errors (429) - retryable but with backoff
      if (error instanceof AllegroRateLimitException) {
        // Rate limit - retryable, but runner will handle backoff
        throw new SyncJobExecutionError(
          `Rate limit exceeded: ${error.message} (connection: ${job.connectionId})`,
          job.id,
          job.jobType,
          job.connectionId,
          error,
        );
      }

      // Other errors are retryable (network, 5xx, etc.)
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Allegro orders poll failed (connection: ${job.connectionId}): ${errorMessage}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Extract and validate payload from job
   */
  private getPayload(job: SyncJob): AllegroOrdersPollPayload {
    const payload = job.payload as unknown as AllegroOrdersPollPayload;

    if (!payload) {
      throw new SyncJobExecutionError(
        `Missing payload in job: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }

    if (!payload.cursorKey || typeof payload.cursorKey !== 'string') {
      throw new SyncJobExecutionError(
        `Missing or invalid cursorKey in payload: ${JSON.stringify(payload)}`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }

    return payload;
  }
}

