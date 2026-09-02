/**
 * Inventory Service
 *
 * Application service for inventory operations. Provides inventory upsert
 * and read capabilities. Works with internal IDs only; IdentifierMapping is
 * handled by handlers, not by this service.
 *
 * @module libs/core/src/inventory/application/services
 * @implements {IInventoryService}
 * @see {@link IInventoryService} for the service interface
 * @see {@link InventoryRepositoryPort} for persistence port
 */
import { Injectable, Inject } from '@nestjs/common';
import type { IInventoryService } from './inventory.service.interface';
import { InventoryRepositoryPort } from '../../domain/ports/inventory-repository.port';
import type { InventoryItem } from '../../domain/entities/inventory-item.entity';
import type { PruneStaleVariantsResult, ProvenanceScope } from '../../domain/types/inventory.types';
import { Logger } from '@openlinker/shared/logging';
import { INVENTORY_REPOSITORY_TOKEN } from '../../inventory.tokens';
import { SyncJobQueuePort, SYNC_JOB_QUEUE_TOKEN } from '@openlinker/core/sync';

@Injectable()
export class InventoryService implements IInventoryService {
  private readonly logger = new Logger(InventoryService.name);
  // Fallback scope for a propagation whose caller did not name the master it
  // read from. Nothing in the tree reaches this today; keeping it means an
  // out-of-tree caller loses per-scope isolation rather than the enqueue.
  private readonly SYSTEM_CONNECTION_ID = '00000000-0000-0000-0000-000000000000';

  constructor(
    @Inject(INVENTORY_REPOSITORY_TOKEN)
    private readonly inventoryRepository: InventoryRepositoryPort,
    @Inject(SYNC_JOB_QUEUE_TOKEN)
    private readonly jobQueue: SyncJobQueuePort
  ) {}

  async setInventory(item: InventoryItem, sourceConnectionId?: string): Promise<InventoryItem> {
    this.logger.debug(
      `Setting inventory for product: ${item.productId}, variant: ${item.productVariantId ?? 'base'}, location: ${item.locationId ?? 'default'}`
    );

    // The provenance axis is DERIVED from the item, exactly as `upsert`'s own
    // lookup derives it (#2320). The two reads MUST agree: an unscoped read
    // here against a scoped upsert can resolve a DIFFERENT row in the
    // two-master configuration #2320 exists for, so the no-change guard below
    // would compare a foreign connection's quantity against ours - a
    // nondeterministic guard that silently suppresses a propagation whose
    // aggregate really did change (the stale-stock shape #2324 closes).
    const previous = await this.inventoryRepository.findByProductAndVariant(
      item.productId,
      item.productVariantId,
      item.locationId,
      item.sourceConnectionId
    );

    const upserted = await this.inventoryRepository.upsert(item);
    this.logger.debug(`Inventory set: ${upserted.id}`);

    // ADR-058 decision (5), #2324 - BREAKING. The located-write skip that stood
    // here is retired: propagation is variant-keyed and LOCATION-BLIND, because
    // the downstream handler re-reads the variant's aggregate across every live
    // position. Skipping a located write meant a master that locates its stock
    // never propagated at all - the marketplace kept the last pooled number
    // forever, which reads as healthy and is stale stock.
    //
    // The no-change guard below stays ROW-scoped on purpose. It is sound under
    // an aggregate publish because each changed sibling position enqueues its
    // own job, and the handler re-reads the whole aggregate - so ANY one of
    // those enqueues publishes the correct total. A row that genuinely did not
    // change contributes nothing new to the sum, and suppressing it costs
    // nothing. Making this guard aggregate-aware would put an N+1 read on the
    // hottest write path in the system.
    if (previous && previous.availableQuantity === upserted.availableQuantity) {
      this.logger.debug(
        `inventory_write_propagation_skipped_no_change product=${upserted.productId} variant=${upserted.productVariantId ?? 'base'} quantity=${upserted.availableQuantity}`
      );
      return upserted;
    }

    const writeEventToken = upserted.updatedAt.toISOString();
    const dedupeKey = this.buildPropagationDedupeKey(upserted, writeEventToken);
    try {
      await this.jobQueue.enqueue({
        type: 'inventory.propagateToMarketplaces',
        // The master this stock was read from, so the runner's per-scope lane
        // accounting isolates one master's burst from another's (ADR-050
        // decision 3, #2609). A single synthetic id put every propagation in
        // the whole installation into one scope, and a per-scope cap of 1 then
        // serialised all of them behind each other.
        connectionId: sourceConnectionId ?? this.SYSTEM_CONNECTION_ID,
        payload: {
          productId: upserted.productId,
          variantId: upserted.productVariantId,
          inventoryUpdatedAt: writeEventToken,
        },
        options: {
          dedupeKey,
        },
      });

      this.logger.debug(
        `inventory_write_propagation_enqueued product=${upserted.productId} variant=${upserted.productVariantId ?? 'base'} quantity=${upserted.availableQuantity} event=${writeEventToken}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `inventory_write_propagation_enqueue_failed product=${upserted.productId} variant=${upserted.productVariantId ?? 'base'} event=${writeEventToken} reason=${message}`
      );
      // Fail fast: callers should retry the operation to avoid silent propagation loss.
      throw new Error(`Failed to enqueue inventory propagation job: ${message}`);
    }

    return upserted;
  }

  async getInventory(
    productId: string,
    productVariantId?: string | null,
    locationId?: string | null,
    sourceConnectionId?: string | null
  ): Promise<InventoryItem | null> {
    this.logger.debug(
      `Getting inventory for product: ${productId}, variant: ${productVariantId ?? 'base'}, location: ${locationId ?? 'default'}, source: ${sourceConnectionId ?? 'unscoped'}`
    );
    // Forwarded verbatim, `undefined` included: the repository distinguishes
    // "no provenance axis" from every real value, and normalising here would
    // erase that distinction one layer above the code that relies on it.
    return this.inventoryRepository.findByProductAndVariant(
      productId,
      productVariantId,
      locationId,
      sourceConnectionId
    );
  }

  async pruneStaleVariants(
    productId: string,
    currentVariantIds: readonly (string | null)[],
    scope?: ProvenanceScope
  ): Promise<PruneStaleVariantsResult> {
    const result = await this.inventoryRepository.markStaleExceptVariants(
      productId,
      currentVariantIds,
      scope
    );
    if (result.markedCount > 0) {
      this.logger.warn(
        `inventory_prune_marked_stale product=${productId} rows=${result.markedCount} variants=${result.variantIds.length} kept=${currentVariantIds.length} source=${scope?.sourceConnectionId ?? 'unscoped'}`
      );
    }
    return result;
  }

  async staleLocationlessPositionsForSource(
    productId: string,
    locatedVariantKeys: readonly (string | null)[],
    scope: ProvenanceScope
  ): Promise<PruneStaleVariantsResult> {
    const result = await this.inventoryRepository.markLocationlessStaleForSource(
      productId,
      locatedVariantKeys,
      scope
    );
    if (result.markedCount > 0) {
      this.logger.warn(
        `inventory_pooled_position_staled_by_located_write product=${productId} rows=${result.markedCount} variants=${result.variantIds.length} located=${locatedVariantKeys.length} source=${scope.sourceConnectionId}`
      );
    }
    return result;
  }

  /**
   * The propagation dedupe key is deliberately LOCATION-FREE (#2324).
   *
   * The omission is load-bearing, not an oversight: a master that reports N
   * located positions for one variant in a single pull writes them with a
   * shared `updatedAt`, so a location-free key collapses N enqueues into one
   * job - and one job is exactly right, because the handler publishes the
   * aggregate. Adding `locationId` here would fan out N identical publishes.
   *
   * Never quantity-derived (#2285): a quantity-keyed token cannot distinguish
   * two writes of the same value, so a corrective write would be swallowed.
   */
  private buildPropagationDedupeKey(item: InventoryItem, writeEventToken: string): string {
    return [
      'inventory:propagate',
      item.productId,
      item.productVariantId ?? 'base',
      writeEventToken,
    ].join(':');
  }
}
