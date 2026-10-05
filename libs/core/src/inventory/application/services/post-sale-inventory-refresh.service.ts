/**
 * Post-Sale Inventory Refresh Service
 *
 * Re-reads a master's stock for the products a sale just moved, so the
 * marketplace quantity does not have to wait for the next scheduled sweep.
 *
 * WHY THIS IS A SERVICE AND NOT TWO COPIES. It was originally private to
 * `OrderSyncService` and fired once, right after the destination order was
 * created. On a master where the ORDER moves stock that is correct. On a master
 * where the DOCUMENT moves it — Subiekt, where the FS/PA carries the warehouse
 * release — it fires too early and reads the pre-sale quantity. Measured: the
 * two refresh jobs for one order completed at 21:10:05.385 and .386, and the
 * `invoicing.issue` that actually dropped the stock completed at 21:10:10.504,
 * 5.1 s later. The refresh therefore re-read a number the sale had not yet
 * changed, and because its dedupe key was order-scoped it could never fire
 * again — the correct figure only arrived at the next sweep.
 *
 * THE FIX IS A SECOND CALL IN A DIFFERENT KEY SCOPE, not a moved one. The early
 * call stays exactly as it was: making it conditional would mean predicting the
 * auto-issue policy at order-sync time, which `AutoIssueTriggerService` decides
 * later and per order, so the predicate would be wrong for every order the
 * policy skips and would silently remove their only fast path. An order that
 * never produces a document keeps today's behaviour.
 *
 * `keyScope` IS THE WHOLE IDEMPOTENCY DESIGN. `SyncJobRepository` dedupes on
 * `idempotencyKey` with no status or time scoping, so a key is spent forever.
 * A caller passes a scope naming the EVENT it is reacting to — `order:{id}`
 * for the early call, `invoice:{recordId}` / `receipt:{recordId}` for the
 * post-document one. Each is a genuinely distinct event, so each fires exactly
 * once, and the upper bound on refreshes per order is the number of documents
 * issued against it. A retried document job resolves to the same record id,
 * hence the same key, hence no re-enqueue. Never build a scope from a counter
 * or a timestamp: against a forever-unique index that is an unbounded enqueue.
 *
 * @module libs/core/src/inventory/application/services
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import {
  CORE_ENTITY_TYPE,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  type IIdentifierMappingService,
} from '@openlinker/core/identifier-mapping';
import {
  INTEGRATIONS_SERVICE_TOKEN,
  type IIntegrationsService,
} from '@openlinker/core/integrations';
import { SYNC_JOB_QUEUE_TOKEN, type SyncJobQueuePort } from '@openlinker/core/sync';
import type {
  IPostSaleInventoryRefreshService,
  PostSaleInventoryRefreshInput,
} from './post-sale-inventory-refresh.service.interface';

@Injectable()
export class PostSaleInventoryRefreshService implements IPostSaleInventoryRefreshService {
  private readonly logger = new Logger(PostSaleInventoryRefreshService.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService,
    @Inject(SYNC_JOB_QUEUE_TOKEN)
    private readonly jobQueue: SyncJobQueuePort
  ) {}

  /**
   * Enqueue one `master.inventory.syncByExternalId` per
   * (`InventoryMaster`-capable connection × mapped product).
   *
   * Never throws: this is a latency optimisation on top of the sweep, so a
   * failure here must not disturb whatever committed the sale. A product with
   * no master mapping simply enqueues nothing for itself.
   */
  async enqueue(input: PostSaleInventoryRefreshInput): Promise<void> {
    const productIds = Array.from(
      new Set(input.productIds.filter((id): id is string => typeof id === 'string' && id !== ''))
    );
    if (productIds.length === 0) {
      return;
    }

    let inventoryMasters;
    try {
      inventoryMasters = await this.integrationsService.listCapabilityAdapters<unknown>({
        capability: 'InventoryMaster',
        lazy: true,
      });
    } catch (error) {
      // The registry lookup is as much a fallible call as the queue enqueue
      // below, and this method's whole contract is that it never throws.
      this.logger.warn(
        `Failed to enqueue post-sale master inventory refresh (scope ${input.keyScope}): capability registry lookup failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return;
    }
    if (inventoryMasters.length === 0) {
      return;
    }
    const masterConnectionIds = new Set(inventoryMasters.map((m) => m.connectionId));

    // allSettled, not all: one product's getExternalIds rejecting must never
    // suppress the enqueues that other products' lookups already resolved.
    await Promise.allSettled(
      productIds.map((productId) =>
        this.enqueueForProduct(input.keyScope, productId, masterConnectionIds)
      )
    );
  }

  private async enqueueForProduct(
    keyScope: string,
    productId: string,
    masterConnectionIds: Set<string>
  ): Promise<void> {
    const mappings = await this.identifierMapping.getExternalIds(
      CORE_ENTITY_TYPE.Product,
      productId
    );

    await Promise.all(
      mappings
        .filter((mapping) => masterConnectionIds.has(mapping.connectionId))
        .map(async (mapping) => {
          try {
            await this.jobQueue.enqueue({
              type: 'master.inventory.syncByExternalId',
              connectionId: mapping.connectionId,
              payload: {
                schemaVersion: 1,
                externalId: mapping.externalId,
                objectType: CORE_ENTITY_TYPE.Inventory,
              },
              options: {
                dedupeKey: buildPostSaleInventoryRefreshKey(
                  keyScope,
                  mapping.connectionId,
                  mapping.externalId
                ),
              },
            });
          } catch (error) {
            this.logger.warn(
              `Failed to enqueue post-sale master inventory refresh (scope ${keyScope}, connection ${mapping.connectionId}, externalId ${mapping.externalId}): ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        })
    );
  }
}

/**
 * The dedupe key, in one place because two callers build it and a drift
 * between them would silently double- or never-enqueue. The `order:` scope
 * reproduces the pre-extraction key byte for byte.
 */
export function buildPostSaleInventoryRefreshKey(
  keyScope: string,
  connectionId: string,
  externalId: string
): string {
  return `${keyScope}:inventory:sync:${connectionId}:${externalId}`;
}
