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
import {
  IInventoryService,
  INVENTORY_SERVICE_TOKEN,
  IAvailabilityService,
  AVAILABILITY_SERVICE_TOKEN,
} from '@openlinker/core/inventory';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { IProductsService, PRODUCTS_SERVICE_TOKEN } from '@openlinker/core/products';

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
    private readonly integrationsService: IIntegrationsService,
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly productsService: IProductsService,
    @Inject(AVAILABILITY_SERVICE_TOKEN)
    private readonly availabilityService: IAvailabilityService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const productId = job.payload?.productId as string | undefined;
    this.logger.log(
      `Executing inventory propagate to marketplaces job ${job.id} for product ${productId ?? 'unknown'}`
    );

    try {
      // Step 1: Validate payload
      const payload = this.validatePayload(job);

      // Step 2: resolve the quantity to publish.
      //
      // #2324 (ADR-058 decision 5): the variant-keyed path reads the
      // AGGREGATE through the availability seam rather than one
      // `(product, variant, location=null)` row. That single-row read was the
      // other half of the retired located-write skip - it summed nothing, so a
      // located master's stock was invisible here even once a job reached it.
      //
      // The scope is GLOBAL, not `channel`, and that is deliberate: the
      // per-connection stock safety buffer (#1844) is a destination Control
      // applied EXACTLY ONCE downstream, per item, by
      // `InventorySyncService.updateOfferQuantities` via
      // `applyPublishControls` (#2323). Asking for a channel scope here would
      // buffer the same number twice - see the "so nothing double-buffers" note
      // on `VariantAvailability.availableToPromise` in `inventory.types.ts`.
      // This handler also fans out to MANY connections from one read, so there
      // is no single channel whose cushion it could defensibly borrow.
      let promisableQuantity: number;
      if (payload.variantId) {
        const [availability] = await this.availabilityService.getPromisableQuantities({
          variantIds: [payload.variantId],
          scope: { kind: 'global' },
        });

        // ADR-061 three-arm switch. `unknown` means the reservation-ledger read
        // failed - OpenLinker does not know the number. Publishing anything
        // here would oversell by the outstanding holds, and swallowing it as
        // `outcome: 'ok'` would be worse than on a cron path: this job is
        // EVENT-DRIVEN with no cron backstop, so a silently-dropped propagation
        // is stock drift until the next unrelated write. Throw, and let the
        // runner's retry ladder re-read a ledger that is probably transiently
        // unavailable. (Posture parity with #2323's write-back arm.)
        if (availability.provenance === 'unknown') {
          this.logger.error(
            `inventory_propagation_suppressed_availability_unknown product=${payload.productId} ` +
              `variant=${payload.variantId} — available-to-promise could not be resolved; no ` +
              `quantity update was enqueued`
          );
          throw new SyncJobExecutionError(
            'Available-to-promise could not be resolved for this variant; the propagation was ' +
              'suppressed rather than publishing a quantity that ignores outstanding reservations.',
            job.id,
            job.jobType,
            job.connectionId || 'N/A'
          );
        }

        // `computed` / `authority` — a real number. Non-null by the seam's
        // contract (`quantity === null` iff `provenance === 'unknown'`).
        promisableQuantity = availability.quantity as number;

        // A variant with no live positions at all is a KNOWN zero, not an
        // absence of knowledge (see `toPromisableQuantity`), and publishing
        // that 0 is correct - it is exactly what #1689's stale-variant pause
        // and #1844's master-is-authoritative-including-zero rule require. It
        // is still worth a line: before #2324 this handler returned early and
        // published nothing at all in that state.
        if (availability.observedAt === null) {
          this.logger.warn(
            `inventory_propagation_no_observed_positions product=${payload.productId} variant=${payload.variantId} — publishing a known zero`
          );
        }
      } else {
        // Legacy product-level tail: a payload with no variantId has no variant
        // to ask the seam about, and the seam is variant-keyed by contract.
        // Master inventory has been variant-keyed since #822/#823, so this arm
        // only serves pre-existing product-level rows; the ShopProduct fan-out
        // below already skips it entirely.
        const inventory = await this.inventoryService.getInventory(
          payload.productId,
          null,
          null // Location ID - legacy product-level rows are pooled by definition
        );

        if (!inventory) {
          this.logger.warn(
            `No product-level inventory found for product ${payload.productId}. Skipping propagation.`
          );
          return { outcome: 'ok' };
        }

        promisableQuantity = inventory.availableQuantity;
      }

      this.logger.debug(
        `Resolved publish quantity for product ${payload.productId}: ${promisableQuantity}`
      );

      // Stale-variant guard (#1689): a variant just zeroed by the stale-offer-
      // pause flow must not be re-raised by a concurrent inventory propagate
      // racing it. Checked only when the payload carries a variantId — a
      // product-level propagate (no variantId) has no single variant to check.
      // The hourly reconcile sweep is the backstop if an in-flight propagate
      // job was already enqueued before the stale-mark landed.
      let variantIsStale = false;
      if (payload.variantId) {
        const variant = await this.productsService.getVariant(payload.variantId);
        variantIsStale = variant?.isStale === true;
      }

      // Step 3: Find all marketplace offers mapped to this internal product
      // (Offer mappings are stored in identifier_mappings as entityType='Offer')
      const mappingTargetId = payload.variantId || payload.productId;
      const offerMappings = variantIsStale
        ? []
        : await this.identifierMapping.getExternalIds(CORE_ENTITY_TYPE.Offer, mappingTargetId);

      if (variantIsStale) {
        this.logger.warn(
          `Skipping offer quantity propagation for stale variant ${payload.variantId} (product ${payload.productId}) — deleted at the master (#1689)`
        );
      }

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
              promisableQuantity,
              // Include write-event token to avoid suppressing legitimate
              // quantity oscillations (e.g. 5->6->5).
              `inventory:${mapping.connectionId}:${payload.productId}:${payload.variantId || 'base'}:${promisableQuantity}:${writeEventToken}`,
              payload.inventoryUpdatedAt
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
              promisableQuantity,
              // Same key scheme as the Offer branch PLUS a branch discriminator
              // + external id: the Offer key omits the target id, so reusing it
              // verbatim would dedupe an Offer update against a ShopProduct
              // update for the same connection/variant/quantity.
              `inventory:${mapping.connectionId}:${payload.productId}:${payload.variantId || 'base'}:${promisableQuantity}:${writeEventToken}:shop:${mapping.externalId}`,
              payload.inventoryUpdatedAt
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
    idempotencyKey: string,
    observedAt: string | null | undefined
  ): Promise<void> {
    const updatePayload = {
      schemaVersion: 1 as const,
      offerId: mapping.externalId,
      quantity,
      idempotencyKey,
      // The inventory row's own write stamp orders two concurrent writes for one
      // offer (#2617). Absent on a legacy propagation payload, which writes
      // unguarded exactly as before.
      ...(observedAt ? { observedAt } : {}),
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
