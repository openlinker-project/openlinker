/**
 * Inventory Propagate to Marketplaces Handler
 *
 * Handles sync jobs of type 'inventory.propagateToMarketplaces'. Propagates
 * inventory changes from canonical storage to marketplace offers (e.g., Allegro)
 * and, since #1498, to shop-published products (WooCommerce) via their
 * `ShopProduct` mappings. Finds both mapping kinds for the product/variant and
 * enqueues one offer quantity update job per target.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Injectable, Inject } from '@nestjs/common';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
  SyncJobRequest,
} from '@openlinker/core/sync';
import { SyncJobExecutionError, JobEnqueuePort, JOB_ENQUEUE_TOKEN } from '@openlinker/core/sync';
import type { ExternalIdMapping } from '@openlinker/core/identifier-mapping';
import {
  IIdentifierMappingService,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  CORE_ENTITY_TYPE,
} from '@openlinker/core/identifier-mapping';
import { IInventoryService, INVENTORY_SERVICE_TOKEN } from '@openlinker/core/inventory';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';

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
 * 3. Find all offer mappings for product; enqueue one
 *    marketplace.offerQuantity.update job per mapping
 * 4. Find all ShopProduct mappings for the variant (#1498); enqueue the same
 *    job per mapping on connections eligible for stock write-back
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
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const productId = job.payload?.productId as string | undefined;
    this.logger.log(
      `Executing inventory propagate to marketplaces job ${job.id} for product ${productId ?? 'unknown'}`
    );

    try {
      // Step 1: Validate payload
      const payload = this.validatePayload(job);

      // Step 2: Get current inventory
      const inventory = await this.inventoryService.getInventory(
        payload.productId,
        payload.variantId || null,
        null // Location ID - MVP assumes single location
      );

      if (!inventory) {
        this.logger.warn(
          `No inventory found for product ${payload.productId}${payload.variantId ? `, variant ${payload.variantId}` : ''}. Skipping propagation.`
        );
        return { outcome: 'ok' };
      }

      const availableQuantity = inventory.availableQuantity;

      this.logger.debug(
        `Current inventory for product ${payload.productId}: ${availableQuantity} available`
      );

      // Step 3: Find all marketplace offers mapped to this internal product
      // (Offer mappings are stored in identifier_mappings as entityType='Offer')
      const mappingTargetId = payload.variantId || payload.productId;
      const offerMappings = await this.identifierMapping.getExternalIds(
        CORE_ENTITY_TYPE.Offer,
        mappingTargetId
      );

      const writeEventToken = payload.inventoryUpdatedAt || 'legacy';

      // Offer branch stays check-free: offers only exist on marketplace
      // connections, and per-platform behaviour belongs in the adapter, not in
      // this thin handler (#582). The downstream
      // MarketplaceOfferQuantityUpdateHandler delegates to
      // `InventorySyncService.updateOfferQuantity`, which resolves
      // `OfferManager` via `IntegrationsService.getCapabilityAdapter` and
      // surfaces a missing-capability connection as a clean domain error.
      if (offerMappings.length > 0) {
        this.logger.log(
          `Found ${offerMappings.length} offer mapping(s) for product ${payload.productId}. Enqueuing quantity update jobs.`
        );
        await Promise.all(
          offerMappings.map((mapping) =>
            this.enqueueQuantityUpdate(
              mapping,
              availableQuantity,
              // Include write-event token to avoid suppressing legitimate
              // quantity oscillations (e.g. 5->6->5).
              `inventory:${mapping.connectionId}:${payload.productId}:${payload.variantId || 'base'}:${availableQuantity}:${writeEventToken}`
            )
          )
        );
      } else {
        this.logger.debug(
          `No offer mappings found for product ${payload.productId}. Skipping marketplace propagation.`
        );
      }

      // Step 4 (#1498): shop-published products. ShopProduct mappings are
      // variant-keyed (internal variant id -> external shop product id), so
      // legacy product-level inventory rows (variantId = null) skip this
      // branch — master inventory has been variant-keyed since #822/#823.
      //
      // UNLIKE the Offer branch, this branch checks eligibility at enqueue
      // time: most shop connections are publish-only (write-back defaults
      // OFF), so unconditional enqueue would produce guaranteed-fail jobs by
      // default. `listCapabilityAdapters` (lazy — no adapter construction)
      // narrows to active connections with `OfferManager` enabled; the
      // inventory-master exclusion is the authoritative runtime authority
      // guard — the master connection must never be a write-back target.
      const shopMappings = payload.variantId
        ? await this.identifierMapping.getExternalIds(
            CORE_ENTITY_TYPE.ShopProduct,
            payload.variantId
          )
        : [];

      let enqueuedShopCount = 0;
      if (shopMappings.length > 0) {
        const writeBackTargets = await this.integrationsService.listCapabilityAdapters({
          capability: 'OfferManager',
          lazy: true,
        });
        const eligibleConnectionIds = new Set(
          writeBackTargets
            .filter((entry) => !entry.connection.enabledCapabilities.includes('InventoryMaster'))
            .map((entry) => entry.connectionId)
        );

        const eligibleShopMappings = shopMappings.filter((mapping) => {
          if (eligibleConnectionIds.has(mapping.connectionId)) {
            return true;
          }
          this.logger.debug(
            `Skipping stock write-back for shop product ${mapping.externalId} (connection: ${mapping.connectionId}) — connection is not an eligible write-back target (OfferManager disabled, connection inactive, or connection is the inventory master).`
          );
          return false;
        });

        await Promise.all(
          eligibleShopMappings.map((mapping) =>
            this.enqueueQuantityUpdate(
              mapping,
              availableQuantity,
              // Same key scheme as the Offer branch PLUS a branch discriminator
              // + external id: the Offer key omits the target id, so reusing it
              // verbatim would dedupe an Offer update against a ShopProduct
              // update for the same connection/variant/quantity.
              `inventory:${mapping.connectionId}:${payload.productId}:${payload.variantId || 'base'}:${availableQuantity}:${writeEventToken}:shop:${mapping.externalId}`
            )
          )
        );
        enqueuedShopCount = eligibleShopMappings.length;
      }

      this.logger.log(
        `Enqueued ${offerMappings.length} offer + ${enqueuedShopCount} shop-product quantity update job(s) for product ${payload.productId}`
      );

      return { outcome: 'ok' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Failed to propagate inventory to marketplaces: ${errorMessage}`,
        job.id,
        job.jobType,
        job.connectionId || 'N/A', // connectionId may be empty for inventory propagation jobs
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Enqueue one marketplace.offerQuantity.update job for a mapping target.
   * Shared by both fan-out branches — only the idempotency key differs.
   */
  private async enqueueQuantityUpdate(
    mapping: ExternalIdMapping,
    quantity: number,
    idempotencyKey: string
  ): Promise<void> {
    const updatePayload = {
      schemaVersion: 1 as const,
      offerId: mapping.externalId,
      quantity,
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
      `Enqueued offer quantity update job for ${mapping.entityType} ${mapping.externalId} (connection: ${mapping.connectionId}, quantity: ${quantity})`
    );
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
        job.connectionId
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
