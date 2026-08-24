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
import { SyncJobQueuePort, SYNC_JOB_QUEUE_TOKEN } from '@openlinker/core/sync';
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
  // inventory.propagateToMarketplaces is global and not tied to one connection
  // (same sentinel InventoryService uses, so both writers enqueue alike).
  private readonly SYSTEM_CONNECTION_ID = '00000000-0000-0000-0000-000000000000';

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
    private readonly masterProductSync: IMasterProductSyncService,
    // #2324 - staling a pooled position CHANGES the variant's aggregate but
    // writes no `inventory_items` row, so `InventoryService.setInventory` never
    // runs for it and nothing would propagate. The enqueue below closes that
    // transition gap.
    @Inject(SYNC_JOB_QUEUE_TOKEN)
    private readonly jobQueue: SyncJobQueuePort
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
    // ADR-058 decision (2) enforcement input (#2322): the variant keys this
    // master just reported AT a location. A pooled (`locationId IS NULL`) row
    // this same source left behind for one of these variants is not a second
    // warehouse - `NULL` is the master declining to locate, never a default
    // location - so it double-counts stock and is repaired below.
    const locatedVariantKeys: (string | null)[] = [];
    const pooledVariantKeys = new Set<string>();
    for (const inventory of inventories) {
      const inventoryItem = await this.toDomainInventoryItem(
        inventory,
        internalProductId,
        connectionId
      );
      await this.inventoryService.setInventory(inventoryItem);
      currentVariantIds.push(inventoryItem.productVariantId);
      if ((inventory.locationId ?? null) !== null) {
        locatedVariantKeys.push(inventoryItem.productVariantId);
      } else {
        pooledVariantKeys.add(inventoryItem.productVariantId ?? '__product_level__');
      }
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
    // ADR-058 decision (2) - "`locationId IS NULL` means the master declines to
    // locate, never a default location" - enforced here, on the write path
    // (#2322). A DB constraint cannot express it before the four-column index
    // (#2325), and a read-time filter would be wrong: a DIFFERENT source's
    // pooled row is legitimate stock and must keep summing. So this is a
    // same-source REPAIR, run after the writes above so the located rows it
    // reacts to already exist.
    //
    // The rejected alternative is worth naming: minting a synthetic DEFAULT
    // location for pooled rows would make the two shapes comparable, and ADR-058
    // forbids it precisely because it invents an answer the master declined to
    // give.
    //
    // A contradiction inside ONE payload (the same variant reported both pooled
    // and located) resolves deterministically - located wins, because the
    // enforcement runs after the whole loop - but it means the master
    // contradicted itself, so it is reported separately from the ordinary case.
    const contradicted = locatedVariantKeys.filter((key) =>
      pooledVariantKeys.has(key ?? '__product_level__')
    );
    if (contradicted.length > 0) {
      this.logger.warn(
        `inventory_pooled_and_located_in_one_response connection=${connectionId} externalId=${externalId} internalProductId=${internalProductId} variants=${contradicted.length} - the master reported the same variant both pooled and located in a single response; the located position wins and the pooled row is staled`
      );
    }

    const pooledStaleResult =
      locatedVariantKeys.length === 0
        ? { markedCount: 0, variantIds: [] }
        : await this.inventoryService.staleLocationlessPositionsForSource(
            internalProductId,
            locatedVariantKeys,
            // INVARIANT (#2320/#2322), mirroring the prune call below:
            // `includeUnattributedProvenance` claims rows no connection owns
            // yet, which is safe only where this connection is the sole
            // `InventoryMaster` claiming the id. With a rival present the claim
            // cannot be attributed, so the repair falls back to strict matching
            // rather than staling a row it cannot prove is its own.
            { sourceConnectionId: connectionId, includeUnattributedProvenance: !pruneSkipped }
          );

    const pruneResult: PruneStaleVariantsResult = pruneSkipped
      ? { markedCount: 0, variantIds: [] }
      : await this.inventoryService.pruneStaleVariants(
          internalProductId,
          currentVariantIds,
          // INVARIANT (#2320): `includeUnattributedProvenance: true` claims rows
          // no connection owns yet, and that is safe here ONLY because this line
          // is unreachable unless `isPruneBlockedByRivalMaster` returned false —
          // i.e. this connection is the sole InventoryMaster claiming the id, so
          // an unattributed row can only be its own. A refactor that moves this
          // prune above the guard, or drops the guard before ADR-058 step (iii),
          // makes the claim unsafe and must flip this flag to false.
          { sourceConnectionId: connectionId, includeUnattributedProvenance: true }
        );

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

    // #2324 (ADR-058 decision 5) - the #2322 transition. When a source that used
    // to report one pooled position starts locating its stock, the pooled row is
    // staled here rather than overwritten: the variant's aggregate drops by the
    // pooled quantity with NO write to any `inventory_items` row, so
    // `InventoryService.setInventory`'s propagation enqueue never fires for it.
    // Without this the marketplace keeps selling the old pooled number until the
    // next unrelated quantity change - which is precisely the stale-stock shape
    // retiring the located-write skip exists to close.
    //
    // The key mirrors `InventoryService.buildPropagationDedupeKey` exactly -
    // variant-keyed and LOCATION-FREE - so a same-tick located `setInventory`
    // enqueue for the same variant collapses into one job. That collapse is
    // DESIRABLE, not a hazard: the handler republishes the aggregate either way,
    // so one job is the correct number of jobs.
    if (pooledStaleResult.markedCount > 0) {
      await this.enqueueAggregatePropagation(internalProductId, pooledStaleResult.variantIds);
    }

    this.logger.debug(
      `Master inventory sync complete (connection: ${connectionId}, externalId: ${externalId}, internalProductId: ${internalProductId}, itemsWritten=${inventories.length}, markedStale=${pruneResult.markedCount}, pooledPositionsStaled=${pooledStaleResult.markedCount}, pruneSkipped=${pruneSkipped}, available=${availableQuantity}, reserved=${reservedQuantity})`
    );

    return {
      internalProductId,
      itemsWritten: inventories.length,
      availableQuantity,
      reservedQuantity,
      masterDeleted: false,
      pruneSkipped,
      pooledPositionsStaled: pooledStaleResult.markedCount,
    };
  }

  /**
   * Enqueue one variant-keyed, location-free `inventory.propagateToMarketplaces`
   * job per variant whose aggregate a pooled-position staling just changed.
   *
   * Best-effort by design, unlike `InventoryService.setInventory`'s fail-fast
   * enqueue: this runs at the tail of a completed master sync whose writes are
   * already durable, so throwing here would re-run the whole pull (and its
   * platform calls) to retry a job the hourly reconcile sweep re-derives from
   * persisted state anyway. A failure is logged loudly instead.
   */
  private async enqueueAggregatePropagation(
    internalProductId: string,
    variantIds: readonly (string | null)[]
  ): Promise<void> {
    // One staling moment for the whole batch, so N variants staled by one pull
    // carry one comparable token rather than N clock reads.
    const writeEventToken = new Date().toISOString();
    // A product-level (NULL-variant) pooled row still changes the product's
    // aggregate, so it propagates too - as the legacy product-level arm, which
    // is what `variantId: null` means to the handler.
    const targets = variantIds.length > 0 ? variantIds : [null];

    await Promise.all(
      targets.map(async (variantId) => {
        try {
          await this.jobQueue.enqueue({
            type: 'inventory.propagateToMarketplaces',
            connectionId: this.SYSTEM_CONNECTION_ID,
            payload: {
              productId: internalProductId,
              variantId,
              inventoryUpdatedAt: writeEventToken,
            },
            options: {
              dedupeKey: [
                'inventory:propagate',
                internalProductId,
                variantId ?? 'base',
                writeEventToken,
              ].join(':'),
            },
          });
          this.logger.debug(
            `inventory_pooled_stale_propagation_enqueued product=${internalProductId} variant=${variantId ?? 'base'} event=${writeEventToken}`
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(
            `inventory_pooled_stale_propagation_enqueue_failed product=${internalProductId} variant=${variantId ?? 'base'} event=${writeEventToken} reason=${message}`
          );
        }
      })
    );
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
        pooledPositionsStaled: 0,
      };
    }

    // Same invariant as the partial-prune path above: the rival guard has
    // already returned false, so unattributed rows can only be this
    // connection's (#2320).
    const pruneResult = await this.inventoryService.pruneStaleVariants(internalProductId, [], {
      sourceConnectionId: connectionId,
      includeUnattributedProvenance: true,
    });

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
      pooledPositionsStaled: 0,
    };
  }

  /**
   * Connection-ownership guard for the staleness prune (#1904).
   *
   * **Unchanged by #2320, and deliberately so.** The prune is now
   * provenance-scoped, which narrows what it sweeps but does not make this
   * guard redundant: the scope claims unattributed rows (NULL / `'legacy'`),
   * and only this guard establishes that such a row can safely be assumed to be
   * ours. The column also still flaps where two masters claim one id (#2314),
   * so it is not yet authoritative. The guard retires with ADR-058 step (iii)
   * (#2325), not before — `pruneSkipped` reporting is likewise untouched.
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

  /**
   * `connectionId` stamps the row's provenance (ADR-058 ladder step (i), #2314):
   * this sync is by definition the connection that owns the position it just
   * pulled. It is threaded as a parameter rather than read off a field so no
   * call site can reach the constructor without supplying one.
   */
  private async toDomainInventoryItem(
    inventory: InventoryPortInterface,
    productId: string,
    connectionId: string
  ): Promise<InventoryItemDomainEntity> {
    const variantId = await this.resolveVariantId(inventory, productId);

    // Provenance-scoped (#2320) and load-bearing: `existing?.id` below is
    // reused as the row identity, so an unscoped lookup would hand this
    // connection a RIVAL connection's row id and the upsert would clobber it —
    // the exact defect ADR-058 decision (4) closes.
    const existing = await this.inventoryService.getInventory(
      productId,
      variantId,
      inventory.locationId ?? null,
      connectionId
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
      inventory.updatedAt ?? new Date(),
      // `isStale` must now be passed explicitly to reach `sourceConnectionId`.
      // `false` is the constructor default this call site previously relied on,
      // and is the correct value: a row the master just reported is live (#1478).
      false,
      connectionId
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
