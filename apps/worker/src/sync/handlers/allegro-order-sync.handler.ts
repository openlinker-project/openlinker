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
import { OrderRecordService } from '@openlinker/core/orders';
import { OrderCustomerProjectionUpdaterService } from '@openlinker/core/customers';
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
    private readonly projectionUpdater: OrderCustomerProjectionUpdaterService,
    private readonly orderRecordService: OrderRecordService,
  ) {}

  async execute(job: SyncJob): Promise<void> {
    this.logger.log(
      `Executing Allegro order sync job ${job.id} for connection ${job.connectionId}`,
    );

    let orderId: string | null = null;
    const destinationConnectionId = process.env.ORDER_SYNC_DESTINATION_CONNECTION_ID || null;

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
      orderId = order.id; // Store order ID for error handling

      this.logger.debug(`id: 111 order: ${JSON.stringify(order)}`);
      this.logger.debug(
        `Fetched unified order: id=${order.id}, orderNumber=${order.orderNumber}, items=${order.items.length}`,
      );

      // Step 3.5: Persist order record (for retry/debug support)
      try {
        await this.orderRecordService.persistOrder(order, job.connectionId, payload.eventId);
        this.logger.debug(`Persisted order record for order ${order.id}`);
      } catch (error) {
        // Log error but don't fail the job - order persistence is non-critical
        this.logger.warn(
          `Failed to persist order record for order ${order.id}: ${(error as Error).message}`,
          error,
        );
      }

      // Step 3.6: Update customer projections (if customer ID is available)
      if (order.customerId) {
        try {
          await this.projectionUpdater.updateProjectionsForOrder(
            order,
            order.customerId,
            job.connectionId,
          );
          this.logger.debug(
            `Updated customer projections for order ${order.id} (customer: ${order.customerId})`,
          );
        } catch (error) {
          // Log error but don't fail the job - projection updates are non-critical
          this.logger.warn(
            `Failed to update customer projections for order ${order.id}: ${(error as Error).message}`,
            error,
          );
        }
      } else {
        this.logger.debug(
          `Skipping customer projection update: customer ID not available for order ${order.id}`,
        );
      }

      // Step 4: Route order to OrderSyncService
      const syncResults = await this.orderSyncService.syncOrder({
        order,
        sourceConnectionId: job.connectionId,
        sourceEventId: payload.eventId,
      });

      this.logger.debug(
        `Order ${order.id} synced to ${syncResults.length} destination(s)`,
      );

      // Step 4.5: Update sync status in order record for each destination (success)
      for (const syncResult of syncResults) {
        try {
          await this.orderRecordService.updateSyncStatus(order.id, syncResult.destinationConnectionId, {
            destinationConnectionId: syncResult.destinationConnectionId,
            status: 'synced',
            syncedAt: new Date(),
            externalOrderId: syncResult.orderRef.orderId,
            externalOrderNumber: syncResult.orderRef.orderNumber,
          });
          this.logger.debug(
            `Updated sync status for order ${order.id} → destination ${syncResult.destinationConnectionId}`,
          );
        } catch (error) {
          // Log error but don't fail the job - sync status update is non-critical
          this.logger.warn(
            `Failed to update sync status for order ${order.id}: ${(error as Error).message}`,
            error,
          );
        }
      }

      this.logger.log(
        `Allegro order sync completed for job ${job.id} (order: ${order.id}, checkoutFormId: ${payload.checkoutFormId})`,
      );
    } catch (error) {
      // Update sync status to 'failed' before re-throwing (if we have order data)
      if (orderId && destinationConnectionId) {
        try {
          await this.orderRecordService.updateSyncStatus(orderId, destinationConnectionId, {
            destinationConnectionId,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          });
        } catch (statusError) {
          // Log error but don't fail the job - sync status update is non-critical
          this.logger.warn(
            `Failed to update sync status (failed) for order ${orderId}: ${(statusError as Error).message}`,
            statusError,
          );
        }
      }

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

