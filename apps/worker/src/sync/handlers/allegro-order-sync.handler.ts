/**
 * Allegro Order Sync Handler
 *
 * Handles sync jobs of type 'allegro.order.syncByCheckoutFormId'. Fetches a full
 * order from Allegro by checkout form ID and routes it to the OrderSync pipeline
 * for processing by destination OrderProcessorManager adapters.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Injectable, Inject } from '@nestjs/common';
import {
  SyncJobHandler,
  SyncJob as SyncJobEntity,
  SyncJobExecutionError,
  AllegroOrderSyncByCheckoutFormIdPayload,
} from '@openlinker/core/sync';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { MarketplaceIntegrationPort } from '@openlinker/core/listings';

type SyncJob = SyncJobEntity;
import { IOrderSyncService, ORDER_SYNC_SERVICE_TOKEN } from '@openlinker/core/orders';
import {
  AllegroAuthenticationException,
  AllegroRateLimitException,
} from '@openlinker/integrations-allegro';
import { Logger } from '@openlinker/shared/logging';

/**
 * Allegro Order Sync Handler
 *
 * Implements SyncJobHandler for 'allegro.order.syncByCheckoutFormId' jobs.
 * Workflow:
 * 1. Validate payload (checkoutFormId, eventId)
 * 2. Resolve Marketplace adapter via IntegrationsService
 * 3. Fetch unified order via getOrderByCheckoutFormId
 * 4. Route order to OrderSyncService for processing by destination processors
 */
@Injectable()
export class AllegroOrderSyncHandler implements SyncJobHandler {
  private readonly logger = new Logger(AllegroOrderSyncHandler.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(ORDER_SYNC_SERVICE_TOKEN)
    private readonly orderSyncService: IOrderSyncService,
  ) {}

  async execute(job: SyncJob): Promise<void> {
    this.logger.log(
      `Executing Allegro order sync job ${job.id} for connection ${job.connectionId}`,
    );

    try {
      // Step 1: Validate payload
      const payload = this.getPayload(job);

      this.logger.debug(
        `Syncing order: checkoutFormId=${payload.checkoutFormId}, eventId=${payload.eventId}`,
      );

      // Step 2: Resolve Marketplace adapter
      const marketplaceAdapter = await this.integrationsService.getCapabilityAdapter<MarketplaceIntegrationPort>(
        job.connectionId,
        'Marketplace',
      );

      // Step 3: Fetch unified order
      const order = await marketplaceAdapter.getOrderByCheckoutFormId(payload.checkoutFormId);

      this.logger.debug(
        `Fetched unified order: id=${order.id}, orderNumber=${order.orderNumber}, items=${order.items.length}`,
      );

      // Step 4: Route order to OrderSyncService
      const syncResults = await this.orderSyncService.syncOrder({
        order,
        sourceConnectionId: job.connectionId,
        sourceEventId: payload.eventId,
      });

      this.logger.debug(
        `Order ${order.id} synced to ${syncResults.length} destination(s)`,
      );

      this.logger.log(
        `Allegro order sync completed for job ${job.id} (order: ${order.id}, checkoutFormId: ${payload.checkoutFormId})`,
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
        `Allegro order sync failed (connection: ${job.connectionId}): ${errorMessage}`,
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
  private getPayload(job: SyncJob): AllegroOrderSyncByCheckoutFormIdPayload {
    const payload = job.payload as unknown as AllegroOrderSyncByCheckoutFormIdPayload;

    if (!payload) {
      throw new SyncJobExecutionError(
        `Missing payload in job: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }

    if (!payload.checkoutFormId || typeof payload.checkoutFormId !== 'string') {
      throw new SyncJobExecutionError(
        `Missing or invalid checkoutFormId in payload: ${JSON.stringify(payload)}`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }

    if (!payload.eventId || typeof payload.eventId !== 'string') {
      throw new SyncJobExecutionError(
        `Missing or invalid eventId in payload: ${JSON.stringify(payload)}`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }

    return payload;
  }
}

