/**
 * Master Inventory Sync Service
 *
 * Core-owned orchestration for syncing inventory data from a master connection
 * to canonical storage.
 *
 * @module libs/core/src/inventory/application/services
 */

import { Injectable, Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
  IEntityClaimService,
  ENTITY_CLAIM_SERVICE_TOKEN,
} from '@openlinker/core/integrations';
import { IIdentifierMappingService, IDENTIFIER_MAPPING_SERVICE_TOKEN, CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import {
  IProductsService,
  PRODUCTS_SERVICE_TOKEN,
  MASTER_DELETION_EVENT_STREAM,
  MASTER_DELETION_EVENT_SCHEMA_VERSION,
  MASTER_VARIANT_STALE_EVENT,
  MasterProductNotFoundError,
  MASTER_PRODUCT_SYNC_SERVICE_TOKEN,
  type IMasterProductSyncService,
  type MasterDeletionEventPayload,
} from '@openlinker/core/products';
import { EventPublisherPort, EVENT_PUBLISHER_TOKEN } from '@openlinker/core/events';
import { INVENTORY_SERVICE_TOKEN } from '../../inventory.tokens';
import { IInventoryService } from './inventory.service.interface';
import type {
  InventoryMasterPort,
  Inventory as InventoryPortInterface,
} from '../../domain/ports/inventory-master.port';
import { InventoryItem as InventoryItemDomainEntity } from '../../domain/entities/inventory-item.entity';
import type { PruneStaleVariantsResult } from '../../domain/types/inventory.types';
import type {
  IMasterInventorySyncService,
  MasterInventorySyncResult,
} from './master-inventory-sync.service.interface';
import { Logger } from '@openlinker/shared/logging';

@Injectable()
export class MasterInventorySyncService implements IMasterInventorySyncService {
  private readonly logger = new Logger(MasterInventorySyncService.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService,
    @Inject(INVENTORY_SERVICE_TOKEN)
    private readonly inventoryService: IInventoryService,
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly productsService: IProductsService,
    @Inject(EVENT_PUBLISHER_TOKEN)
    private readonly eventPublisher: EventPublisherPort,
    @Inject(ENTITY_CLAIM_SERVICE_TOKEN)
    private readonly entityClaims: IEntityClaimService,
    // The products context owns `product_variants`, which is the flag #1689
    // re-verifies against - so a confirmed deletion is routed there rather
    // than written twice (#2222). Cross-context via the published `I*Service`
    // seam; `inventory -> products` is an existing edge.
    @Inject(MASTER_PRODUCT_SYNC_SERVICE_TOKEN)
    private readonly masterProductSync: IMasterProductSyncService
  ) {}

  async syncFromMasterByExternalId(
    connectionId: string,
    externalId: string
  ): Promise<MasterInventorySyncResult> {
    const internalProductId = await this.identifierMapping.getOrCreateInternalId(
      CORE_ENTITY_TYPE.Product,
      externalId,
      connectionId
    );

    const inventoryAdapter =
      await this.integrationsService.getCapabilityAdapter<InventoryMasterPort>(
        connectionId,
        'InventoryMaster'
      );

    // One Inventory per variant — per-combination rows for multi-variant
    // products, the synthetic variant for simple products (#823). The sync
    // writes one variant-keyed canonical row per entry. A master-side deletion
    // surfaces as the neutral MasterProductNotFoundError (adapters translate
    // their platform not-found at the listInventory port boundary, #1688) —
    // distinct from a transient failure, which rethrows unchanged so the job
    // stays retryable.
    let inventories: InventoryPortInterface[];
    try {
      inventories = await inventoryAdapter.listInventory(internalProductId);
    } catch (error) {
      if (error instanceof MasterProductNotFoundError) {
        return this.handleMasterDeletion(connectionId, externalId, internalProductId);
      }
      throw error;
    }

    let availableQuantity = 0;
    let reservedQuantity = 0;
    const currentVariantIds: (string | null)[] = [];
    for (const inventory of inventories) {
      const inventoryItem = await this.toDomainInventoryItem(inventory, internalProductId);
      await this.inventoryService.setInventory(inventoryItem);
      currentVariantIds.push(inventoryItem.productVariantId);
      availableQuantity += inventoryItem.availableQuantity;
      reservedQuantity += inventoryItem.reservedQuantity;
    }

    // Soft-mark any previously-known variant absent from this master response as
    // stale. A genuine full deletion is caught above via MasterProductNotFoundError
    // before ever reaching here (#1688); this prune instead catches a PARTIAL
    // removal (some variants gone, the product itself still resolves) or an
    // adapter returning an empty list without throwing (e.g. a variable product
    // with zero variations) — runs unconditionally, so an empty response still
    // marks every currently-known row stale (#1478). Unlike the products-context
    // MasterProductSyncService, which skips its equivalent prune on a
    // successful-but-empty pull to avoid staling everything on a flaky response,
    // this side prunes unconditionally on purpose - the two are intentionally
    // asymmetric here, not drifted. The asymmetry is made observable below: an
    // empty response that stales rows is warn-logged, so a silent full-stale
    // can't happen without an operator-visible signal.
    //
    // Connection-ownership guard: the prune keys on internalProductId alone, so
    // it is only safe while this connection is the sole InventoryMaster claiming
    // that id (#1904).
    const pruneSkipped = await this.isPruneBlockedByRivalMaster(
      connectionId,
      externalId,
      internalProductId
    );
    const pruneResult: PruneStaleVariantsResult = pruneSkipped
      ? { markedCount: 0, variantIds: [] }
      : await this.inventoryService.pruneStaleVariants(internalProductId, currentVariantIds);

    // A successful-but-empty master response that stales every currently-known
    // row is the one case where this side's unconditional prune diverges from
    // the products context (which skips its prune instead). It is reported as
    // masterDeleted=false / outcome='ok' - correct, since the product itself
    // still resolves at the master - so without this warn the full-stale would
    // leave no trace anywhere. Reachable e.g. for a WooCommerce variable
    // product whose variations list comes back empty without a 404.
    if (inventories.length === 0 && pruneResult.markedCount > 0) {
      this.logger.warn(
        `master_inventory_empty_response_full_stale connection=${connectionId} externalId=${externalId} internalProductId=${internalProductId} markedStale=${pruneResult.markedCount} — master returned no inventory rows while the product still resolves; every known row was marked stale`
      );
    }

    // Emit the master-deletion signal from the inventory prune path too (#1599).
    // Disjoint from the product-sync emission — a full deletion produces one from
    // each sync path; consumers dedupe by (productId, variantIds) as needed.
    //
    // Gated on markedCount (not variantIds.length) — a product-level, NULL-variant
    // row contributes to markedCount but not to variantIds, and previously such a
    // prune emitted nothing at all (#1689).
    if (pruneResult.markedCount > 0) {
      const correlationId = randomUUID();
      // Always the variant-level event, never `master.product.stale`: an empty
      // master response is NOT a deletion (the product still resolves there, so
      // this path reports masterDeleted=false, #1903). Only the confirmed
      // not-found in `handleMasterDeletion` emits the product-level event.
      this.logger.warn(
        `Master inventory sync marked rows stale (connection: ${connectionId}, externalId: ${externalId}, internalProductId: ${internalProductId}, correlationId: ${correlationId}, markedRows=${pruneResult.markedCount}, markedVariants=${pruneResult.variantIds.length})`
      );
      const payload: MasterDeletionEventPayload = {
        connectionId,
        internalProductId,
        variantIds: pruneResult.variantIds,
        externalId,
        correlationId,
      };
      const now = new Date().toISOString();
      await this.eventPublisher.publish(MASTER_DELETION_EVENT_STREAM, {
        eventId: randomUUID(),
        eventType: MASTER_VARIANT_STALE_EVENT,
        payloadJson: JSON.stringify(payload),
        metadataJson: JSON.stringify({ schemaVersion: MASTER_DELETION_EVENT_SCHEMA_VERSION }),
        occurredAt: now,
        publishedAt: now,
      });
    }

    this.logger.debug(
      `Master inventory sync complete (connection: ${connectionId}, externalId: ${externalId}, internalProductId: ${internalProductId}, itemsWritten=${inventories.length}, markedStale=${pruneResult.markedCount}, pruneSkipped=${pruneSkipped}, available=${availableQuantity}, reserved=${reservedQuantity})`
    );

    return {
      internalProductId,
      itemsWritten: inventories.length,
      availableQuantity,
      reservedQuantity,
      masterDeleted: false,
      pruneSkipped,
    };
  }

  /**
   * Product deleted at the master (its inventory no longer resolves there):
   * mark every one of its inventory rows stale (empty keep-set), emit
   * `master.product.stale`, and signal the deletion so the worker handler does
   * NOT retry a permanent condition (#1688, mirrors
   * `MasterProductSyncService.handleMasterDeletion`, #1599).
   */
  private async handleMasterDeletion(
    connectionId: string,
    externalId: string,
    internalProductId: string
  ): Promise<MasterInventorySyncResult> {
    // Same guard as the partial-prune path: a not-found from ONE master must not
    // stale rows a sibling InventoryMaster still considers live (#1904).
    if (await this.isPruneBlockedByRivalMaster(connectionId, externalId, internalProductId)) {
      return {
        internalProductId,
        itemsWritten: 0,
        availableQuantity: 0,
        reservedQuantity: 0,
        masterDeleted: true,
        pruneSkipped: true,
      };
    }

    const pruneResult = await this.inventoryService.pruneStaleVariants(internalProductId, []);

    // ...and then hand the SAME confirmed deletion to the products context,
    // which owns `product_variants.isStale` (#2222).
    //
    // This line is the whole point. Staling `inventory_items` alone made the
    // #1689 chain fire and then do nothing: the emitted `master.product.stale`
    // reached `marketplace.offer.pauseStale`, whose `StaleOfferPauseService`
    // re-verifies `variant.isStale !== true` against `product_variants` - which
    // this path had never written. Every variant failed that check, no offer was
    // paused, and a product deleted at the master kept selling. The hourly
    // `pauseStaleSweep` backstop reads the same variant flag, so it did not
    // catch it either.
    //
    // The delegate emits `master.product.stale` itself (gated on having marked
    // something) and applies its own #1904 rival guard, so this path no longer
    // publishes - one deletion, one event, one authority.
    const delegated = await this.masterProductSync.markProductDeletedAtMaster({
      connectionId,
      externalId,
      internalProductId,
      correlationId: randomUUID(),
    });

    // The delegate's own guard checks a DIFFERENT capability - `ProductMaster`
    // rivals, where the guard above checked `InventoryMaster` rivals - so the two
    // outcomes genuinely diverge: a connection carrying both capabilities can
    // clear the inventory guard and still be withheld on the products side.
    // Reporting `false` there would claim a prune ran that did not, and
    // architecture-overview.md § Products states the contract as "on a hit the
    // prune is withheld ... and the sync result reports `pruneSkipped: true`".
    // At this point both flags mean the same thing - the deletion was not fully
    // applied - so the withheld outcome propagates.
    const pruneSkipped = delegated.pruneSkipped;

    this.logger.warn(
      `Master inventory deleted at source — marked rows stale (connection: ${connectionId}, externalId: ${externalId}, internalProductId: ${internalProductId}, markedStale=${pruneResult.markedCount}, variantPruneSkipped=${String(pruneSkipped)})`
    );
    return {
      internalProductId,
      itemsWritten: 0,
      availableQuantity: 0,
      reservedQuantity: 0,
      masterDeleted: true,
      pruneSkipped,
    };
  }

  /**
   * Connection-ownership guard for the staleness prune (#1904).
   *
   * `inventory_items` carries no connection provenance, so a prune keyed on the
   * internal product id sweeps every row of that id regardless of which
   * connection wrote it. That is safe only while ONE connection with
   * `InventoryMaster` enabled claims the id - the normal case, since
   * `getOrCreateInternalId` namespaces per `(entityType, externalId,
   * connectionId)`. If a second capable claimant exists, the prune cannot be
   * attributed, so it is withheld (never staling a sibling's live rows) and the
   * condition is logged for operator intervention. Mirrors
   * `MasterProductSyncService.isPruneBlockedByRivalMaster`.
   */
  private async isPruneBlockedByRivalMaster(
    connectionId: string,
    externalId: string,
    internalProductId: string
  ): Promise<boolean> {
    const rivals = await this.entityClaims.findRivalClaimants({
      entityType: CORE_ENTITY_TYPE.Product,
      internalId: internalProductId,
      capability: 'InventoryMaster',
      excludeConnectionId: connectionId,
    });
    if (rivals.length === 0) {
      return false;
    }
    this.logger.error(
      `inventory_prune_skipped_rival_master_connections - internal product id is claimed by more than one InventoryMaster connection, so the staleness prune cannot be attributed and was withheld (connection: ${connectionId}, externalId: ${externalId}, internalProductId: ${internalProductId}, rivals=${rivals.join(',')})`
    );
    return true;
  }

  private async toDomainInventoryItem(
    inventory: InventoryPortInterface,
    productId: string
  ): Promise<InventoryItemDomainEntity> {
    const variantId = await this.resolveVariantId(inventory, productId);

    const existing = await this.inventoryService.getInventory(
      productId,
      variantId,
      inventory.locationId ?? null
    );

    const inventoryItemId = existing?.id ?? randomUUID();

    const availableQuantity =
      inventory.available ?? (inventory.quantity ?? 0) - (inventory.reserved ?? 0);

    return new InventoryItemDomainEntity(
      inventoryItemId,
      productId,
      variantId,
      availableQuantity,
      inventory.reserved ?? 0,
      inventory.locationId ?? null,
      inventory.updatedAt ?? new Date()
    );
  }

  /**
   * Resolve the variant the inventory row is keyed to (#822). The canonical
   * mapping/offer target is the variant, so master inventory is keyed to the
   * product's variant rather than the bare product — this is what lets the
   * variant-keyed availability read (the bulk offer wizard) find stock.
   *
   * - An adapter that already knows the variant wins. Since #823 the PrestaShop
   *   adapter supplies a variantId per combination (and for the synthetic
   *   variant) via `listInventory`, so this is the normal path.
   * - Safety net for an adapter that doesn't set variantId: a product with
   *   exactly one variant ⇒ key to it; multiple/zero variants ⇒ product-level
   *   (`null`).
   */
  private async resolveVariantId(
    inventory: InventoryPortInterface,
    productId: string
  ): Promise<string | null> {
    if (inventory.variantId) {
      return inventory.variantId;
    }

    const variants = await this.productsService.getVariantsByProductId(productId);
    if (variants.length === 1) {
      return variants[0].id;
    }

    this.logger.debug(
      `master_inventory_product_level_fallback product=${productId} variants=${variants.length} (multi/zero-variant — kept product-level pending #823/#824)`
    );
    return null;
  }
}
