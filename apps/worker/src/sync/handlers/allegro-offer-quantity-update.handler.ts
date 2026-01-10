/**
 * Allegro Offer Quantity Update Handler
 *
 * Handles sync jobs of type 'allegro.offerQuantity.update'. Updates the quantity
 * of an Allegro offer using the command pattern. Tracks command status for observability.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Injectable, Inject } from '@nestjs/common';
import {
  SyncJobHandler,
  SyncJob as SyncJobEntity,
  SyncJobExecutionError,
  AllegroOfferQuantityUpdatePayload,
} from '@openlinker/core/sync';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { MarketplaceIntegrationPort } from '@openlinker/core/listings';

type SyncJob = SyncJobEntity;
import {
  AllegroAuthenticationException,
  AllegroRateLimitException,
  AllegroQuantityCommandRepositoryPort,
  ALLEGRO_QUANTITY_COMMAND_REPOSITORY_TOKEN,
  AllegroQuantityCommand,
} from '@openlinker/integrations-allegro';
import { Logger } from '@openlinker/shared/logging';

/**
 * Allegro Offer Quantity Update Handler
 *
 * Implements SyncJobHandler for 'allegro.offerQuantity.update' jobs.
 * Workflow:
 * 1. Validate payload (offerId, quantity, idempotencyKey)
 * 2. Resolve Marketplace adapter via IntegrationsService
 * 3. Call updateOfferQuantity with idempotency key
 * 4. Log command status for observability
 */
@Injectable()
export class AllegroOfferQuantityUpdateHandler implements SyncJobHandler {
  private readonly logger = new Logger(AllegroOfferQuantityUpdateHandler.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(ALLEGRO_QUANTITY_COMMAND_REPOSITORY_TOKEN)
    private readonly commandRepository: AllegroQuantityCommandRepositoryPort,
  ) {}

  async execute(job: SyncJob): Promise<void> {
    this.logger.log(
      `Executing Allegro offer quantity update job ${job.id} for connection ${job.connectionId}`,
    );

    try {
      // Step 1: Validate payload
      const payload = this.getPayload(job);

      this.logger.debug(
        `Updating offer quantity: offerId=${payload.offerId}, quantity=${payload.quantity}, idempotencyKey=${payload.idempotencyKey}`,
      );

      // Step 2: Resolve Marketplace adapter
      const marketplaceAdapter = await this.integrationsService.getCapabilityAdapter<MarketplaceIntegrationPort>(
        job.connectionId,
        'Marketplace',
      );

      // Step 3: Call updateOfferQuantity
      const result = await marketplaceAdapter.updateOfferQuantity({
        offerId: payload.offerId,
        quantity: payload.quantity,
        idempotencyKey: payload.idempotencyKey,
      });

      this.logger.log(
        `Offer quantity update command submitted: commandId=${result.commandId}, status=${result.status} (offerId: ${payload.offerId})`,
      );

      // Step 4: Persist command status for observability
      try {
        const command = AllegroQuantityCommand.create(
          result.commandId,
          job.connectionId,
          payload.offerId,
          payload.quantity,
          result.status,
        );
        await this.commandRepository.create(command);
        this.logger.debug(`Command status persisted: commandId=${result.commandId}, status=${result.status}`);
      } catch (error) {
        // Log error but don't fail the job if persistence fails
        // Command was successfully submitted to Allegro, persistence is for observability only
        this.logger.error(
          `Failed to persist command status (commandId: ${result.commandId}): ${(error as Error).message}`,
          error,
        );
      }

      if (result.status === 'rejected') {
        // Command was rejected - this is a permanent failure
        throw new SyncJobExecutionError(
          `Offer quantity update command rejected: commandId=${result.commandId}, offerId=${payload.offerId}`,
          job.id,
          job.jobType,
          job.connectionId,
        );
      }

      this.logger.log(
        `Allegro offer quantity update completed for job ${job.id} (commandId: ${result.commandId}, status: ${result.status})`,
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
        `Allegro offer quantity update failed (connection: ${job.connectionId}): ${errorMessage}`,
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
  private getPayload(job: SyncJob): AllegroOfferQuantityUpdatePayload {
    const payload = job.payload as unknown as AllegroOfferQuantityUpdatePayload;

    if (!payload) {
      throw new SyncJobExecutionError(
        `Missing payload in job: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }

    if (!payload.offerId || typeof payload.offerId !== 'string') {
      throw new SyncJobExecutionError(
        `Missing or invalid offerId in payload: ${JSON.stringify(payload)}`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }

    if (payload.quantity === undefined || payload.quantity === null || typeof payload.quantity !== 'number') {
      throw new SyncJobExecutionError(
        `Missing or invalid quantity in payload: ${JSON.stringify(payload)}`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }

    if (!payload.idempotencyKey || typeof payload.idempotencyKey !== 'string') {
      throw new SyncJobExecutionError(
        `Missing or invalid idempotencyKey in payload: ${JSON.stringify(payload)}`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }

    return payload;
  }
}

