/**
 * Inventory Propagate to Marketplaces Handler
 *
 * Handles sync jobs of type 'inventory.propagateToMarketplaces'. Propagates
 * inventory changes from canonical storage to marketplace offers (e.g., Allegro).
 * Finds offer mappings for the product and enqueues offer quantity update jobs.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Injectable, Inject } from '@nestjs/common';
import {
  SyncJobHandler,
  SyncJob as SyncJobEntity,
  SyncJobExecutionError,
  JobEnqueuePort,
  JOB_ENQUEUE_TOKEN,
  SyncJobRequest,
} from '@openlinker/core/sync';
import {
  IIdentifierMappingService,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  ExternalIdMapping,
} from '@openlinker/core/identifier-mapping';
import { IInventoryService, INVENTORY_SERVICE_TOKEN } from '@openlinker/core/inventory';

type SyncJob = SyncJobEntity;
import { Logger } from '@openlinker/shared/logging';

/**
 * Inventory propagate to marketplaces payload
 */
interface InventoryPropagateToMarketplacesPayload {
  productId: string;
  variantId?: string | null;
  inventoryUpdatedAt?: string | null;
}

/**
 * Inventory Propagate to Marketplaces Handler
 *
 * Implements SyncJobHandler for 'inventory.propagateToMarketplaces' jobs.
 * Workflow:
 * 1. Validate payload (productId, optional variantId)
 * 2. Get current inventory for product
 * 3. Find all offer mappings for product
 * 4. For each mapping, enqueue marketplace.offerQuantity.update job
 */
@Injectable()
export class InventoryPropagateToMarketplacesHandler implements SyncJobHandler {
  private readonly logger = new Logger(InventoryPropagateToMarketplacesHandler.name);

  constructor(
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService,
    @Inject(INVENTORY_SERVICE_TOKEN)
    private readonly inventoryService: IInventoryService,
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort,
  ) {}

  async execute(job: SyncJob): Promise<void> {
    const productId = job.payload?.productId as string | undefined;
    this.logger.log(
      `Executing inventory propagate to marketplaces job ${job.id} for product ${productId ?? 'unknown'}`,
    );

    try {
      // Step 1: Validate payload
      const payload = this.validatePayload(job);

      // Step 2: Get current inventory
      const inventory = await this.inventoryService.getInventory(
        payload.productId,
        payload.variantId || null,
        null, // Location ID - MVP assumes single location
      );

      if (!inventory) {
        this.logger.warn(
          `No inventory found for product ${payload.productId}${payload.variantId ? `, variant ${payload.variantId}` : ''}. Skipping propagation.`,
        );
        return;
      }

      const availableQuantity = inventory.availableQuantity;

      this.logger.debug(
        `Current inventory for product ${payload.productId}: ${availableQuantity} available`,
      );

      // Step 3: Find all marketplace offers mapped to this internal product
      // (Offer mappings are stored in identifier_mappings as entityType='Offer')
      const mappingTargetId = payload.variantId || payload.productId;
      const mappings = await this.identifierMapping.getExternalIds('Offer', mappingTargetId);

      if (mappings.length === 0) {
        this.logger.debug(
          `No offer mappings found for product ${payload.productId}. Skipping propagation.`,
        );
        return;
      }

      this.logger.log(
        `Found ${mappings.length} offer mapping(s) for product ${payload.productId}. Enqueuing quantity update jobs.`,
      );

      // Step 4: For each mapping, enqueue marketplace.offerQuantity.update job
      // Filter to only Allegro mappings for MVP (platformType === 'allegro')
      const allegroMappings = mappings.filter((m: ExternalIdMapping) => m.platformType === 'allegro');

      if (allegroMappings.length === 0) {
        this.logger.debug(
          `No Allegro offer mappings found for product ${payload.productId}. Skipping propagation.`,
        );
        return;
      }

      const writeEventToken = payload.inventoryUpdatedAt || 'legacy';
      const enqueuePromises = allegroMappings.map(async (mapping) => {
        // Include write-event token to avoid suppressing legitimate quantity oscillations (e.g. 5->6->5).
        const idempotencyKey = `inventory:${mapping.connectionId}:${payload.productId}:${payload.variantId || 'base'}:${availableQuantity}:${writeEventToken}`;

        const updatePayload = {
          schemaVersion: 1 as const,
          offerId: mapping.externalId,
          quantity: availableQuantity,
          idempotencyKey,
        };

        const updateJobRequest: SyncJobRequest = {
          jobType: 'marketplace.offerQuantity.update',
          connectionId: mapping.connectionId,
          payload: updatePayload as unknown as Record<string, unknown>,
          idempotencyKey, // Use same idempotency key for job deduplication
        };

        await this.jobEnqueue.enqueueJob(updateJobRequest);

        this.logger.debug(
          `Enqueued offer quantity update job for offer ${mapping.externalId} (connection: ${mapping.connectionId}, quantity: ${availableQuantity})`,
        );
      });

      await Promise.all(enqueuePromises);

      this.logger.log(
        `Successfully enqueued ${allegroMappings.length} offer quantity update job(s) for product ${payload.productId}`,
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Failed to propagate inventory to marketplaces: ${errorMessage}`,
        job.id,
        job.jobType,
        job.connectionId || 'N/A', // connectionId may be empty for inventory propagation jobs
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Validate payload
   */
  private validatePayload(job: SyncJob): InventoryPropagateToMarketplacesPayload {
    const payload = job.payload as Partial<InventoryPropagateToMarketplacesPayload>;

    if (!payload.productId || typeof payload.productId !== 'string') {
      throw new SyncJobExecutionError(
        `Missing or invalid productId in job payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }

    return {
      productId: payload.productId,
      variantId: payload.variantId || null,
      inventoryUpdatedAt:
        typeof payload.inventoryUpdatedAt === 'string' ? payload.inventoryUpdatedAt : null,
    };
  }
}

