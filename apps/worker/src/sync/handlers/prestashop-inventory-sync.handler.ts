/**
 * PrestaShop Inventory Sync Handler
 *
 * Handles sync jobs of type 'prestashop.inventory.syncByExternalId'.
 * Pulls inventory data from PrestaShop via InventoryMaster adapter
 * and upserts to canonical storage.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Injectable, Inject } from '@nestjs/common';
import {
  SyncJobHandler,
  SyncJob as SyncJobEntity,
  SyncJobExecutionError,
} from '@openlinker/core/sync';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import {
  IIdentifierMappingService,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
} from '@openlinker/core/identifier-mapping';
import {
  IInventoryService,
  INVENTORY_SERVICE_TOKEN,
  InventoryMasterPort,
  Inventory as InventoryPortInterface,
  InventoryItemEntity as InventoryItemDomainEntity,
} from '@openlinker/core/inventory';

type SyncJob = SyncJobEntity;
import {
  PrestashopResourceNotFoundException,
  PrestashopAuthenticationException,
} from '@openlinker/integrations-prestashop';
import { Logger } from '@openlinker/shared/logging';
import { randomUUID } from 'crypto';

/**
 * PrestaShop Inventory Sync Handler
 *
 * Implements SyncJobHandler for 'prestashop.inventory.syncByExternalId' jobs.
 * Workflow:
 * 1. Validate payload (externalId, objectType, eventType)
 * 2. Resolve internal product ID via IdentifierMappingService
 * 3. Resolve InventoryMaster adapter via IntegrationsService
 * 4. Pull inventory from adapter (using internal product ID)
 * 5. Convert port Inventory to domain InventoryItem entity
 * 6. Upsert inventory to canonical storage
 */
@Injectable()
export class PrestashopInventorySyncHandler implements SyncJobHandler {
  private readonly logger = new Logger(PrestashopInventorySyncHandler.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService,
    @Inject(INVENTORY_SERVICE_TOKEN)
    private readonly inventoryService: IInventoryService,
  ) {}

  async execute(job: SyncJob): Promise<void> {
    // Extract externalId early for use in error messages and logging
    let externalId: string;
    try {
      externalId = this.getExternalId(job);
    } catch (error) {
      // If externalId extraction fails, re-throw (already wrapped in SyncJobExecutionError)
      throw error;
    }

    this.logger.log(
      `Executing inventory sync job ${job.id} for connection ${job.connectionId} (externalId: ${externalId})`,
    );

    try {
      // Step 1: Validate payload
      const objectType = this.getObjectType(job);

      if (objectType !== 'Inventory' && objectType !== 'Product') {
        throw new SyncJobExecutionError(
          `Invalid objectType for inventory sync: ${objectType}. Expected 'Inventory' or 'Product'.`,
          job.id,
          job.jobType,
          job.connectionId,
        );
      }

      // Step 2: Resolve internal product ID (inventory is synced by product external ID)
      const internalProductId = await this.identifierMapping.getOrCreateInternalId(
        'Product',
        externalId,
        job.connectionId,
      );

      this.logger.debug(
        `Resolved internal product ID: ${internalProductId} for external ID: ${externalId}`,
      );

      // Step 3: Resolve InventoryMaster adapter
      const inventoryAdapter = await this.integrationsService.getCapabilityAdapter<InventoryMasterPort>(
        job.connectionId,
        'InventoryMaster',
      );

      // Step 4: Pull inventory from adapter (using internal product ID)
      // Note: PrestaShop adapter only supports product-level inventory (not variant-level) in MVP
      const inventoryFromAdapter = await inventoryAdapter.getInventory(internalProductId, undefined);

      // Step 5: Convert port Inventory to domain InventoryItem entity
      const inventoryItem = await this.toDomainInventoryItem(inventoryFromAdapter, internalProductId);

      // Step 6: Upsert inventory to canonical storage
      await this.inventoryService.setInventory(inventoryItem);

      this.logger.log(
        `Inventory sync completed for job ${job.id} (product: ${internalProductId}, quantity: ${inventoryItem.availableQuantity}, reserved: ${inventoryItem.reservedQuantity})`,
      );
    } catch (error) {
      // Re-throw SyncJobExecutionError as-is (already wrapped)
      if (error instanceof SyncJobExecutionError) {
        throw error;
      }

      // Handle non-retryable errors (permanent failures)
      if (error instanceof PrestashopResourceNotFoundException) {
        // Inventory or product not found (404) - permanent failure, should not retry
        // The runner will mark as dead after maxAttempts, but we provide clear error message
        throw new SyncJobExecutionError(
          `Inventory not found: ${error.message} (externalId: ${externalId})`,
          job.id,
          job.jobType,
          job.connectionId,
          error,
        );
      }

      if (error instanceof PrestashopAuthenticationException) {
        // Authentication failure (401) - requires manual intervention
        throw new SyncJobExecutionError(
          `Authentication failed: ${error.message} (connection: ${job.connectionId})`,
          job.id,
          job.jobType,
          job.connectionId,
          error,
        );
      }

      // Other errors are retryable (network, 5xx, etc.)
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Inventory sync failed for externalId ${externalId} (connection: ${job.connectionId}): ${errorMessage}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Extract externalId from job payload
   */
  private getExternalId(job: SyncJob): string {
    const externalId = job.payload?.externalId;
    if (externalId === undefined || externalId === null || typeof externalId !== 'string') {
      throw new SyncJobExecutionError(
        `Missing or invalid externalId in job payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }
    return externalId;
  }

  /**
   * Extract objectType from job payload
   */
  private getObjectType(job: SyncJob): string {
    const objectType = job.payload?.objectType;
    if (objectType === undefined || objectType === null || typeof objectType !== 'string') {
      throw new SyncJobExecutionError(
        `Missing or invalid objectType in job payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }
    return objectType;
  }

  /**
   * Convert port Inventory to domain InventoryItem entity
   *
   * Maps from Inventory port interface (quantity, reserved, available) to
   * InventoryItem domain entity (availableQuantity, reservedQuantity).
   * Handles nullable variantId and locationId.
   *
   * Note: The inventory item ID is determined by checking for existing inventory
   * by unique constraint (productId, productVariantId, locationId). If found,
   * we use its ID for update. Otherwise, we generate a new UUID. The repository's
   * upsert() method will handle the actual upsert logic to prevent race conditions.
   */
  private async toDomainInventoryItem(
    inventory: InventoryPortInterface,
    productId: string,
  ): Promise<InventoryItemDomainEntity> {
    // Check if inventory item already exists (by unique constraint)
    const existing = await this.inventoryService.getInventory(
      productId,
      inventory.variantId ?? null,
      inventory.locationId ?? null,
    );

    // Use existing ID if found, otherwise generate new UUID
    // The repository's upsert() will handle the actual upsert logic
    const inventoryItemId = existing?.id ?? randomUUID();

    // Calculate available quantity with fallback
    const availableQuantity =
      inventory.available ??
      (inventory.quantity ?? 0) - (inventory.reserved ?? 0);

    return new InventoryItemDomainEntity(
      inventoryItemId,
      productId,
      inventory.variantId ?? null, // Variant ID (nullable)
      availableQuantity, // availableQuantity
      inventory.reserved ?? 0, // reservedQuantity
      inventory.locationId ?? null, // Location ID (nullable)
      inventory.updatedAt ?? new Date(), // updatedAt
    );
  }
}

