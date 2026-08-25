/**
 * Inventory Sync Service
 *
 * Core-owned orchestration for propagating inventory-derived quantities to marketplaces.
 *
 * @module libs/core/src/inventory/application/services
 */

import { Injectable, Inject } from '@nestjs/common';
import { createHash } from 'crypto';
import type { OfferManagerPort } from '@openlinker/core/listings';
import { isOfferQuantityBatchUpdater } from '@openlinker/core/listings';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { AVAILABILITY_SERVICE_TOKEN } from '../../inventory.tokens';
import { IAvailabilityService } from './availability.service.interface';
import type {
  UpdateOfferQuantityCommand,
  UpdateOfferQuantitiesBatchCommand,
  UpdateOfferQuantitiesBatchResult,
} from '@openlinker/core/listings';
import type { IInventorySyncService } from './inventory-sync.service.interface';
import { Logger } from '@openlinker/shared/logging';

@Injectable()
export class InventorySyncService implements IInventorySyncService {
  private readonly logger = new Logger(InventorySyncService.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(AVAILABILITY_SERVICE_TOKEN)
    private readonly availabilityService: IAvailabilityService
  ) {}

  async updateOfferQuantity(
    connectionId: string,
    cmd: UpdateOfferQuantityCommand
  ): Promise<UpdateOfferQuantitiesBatchResult> {
    return this.updateOfferQuantities(connectionId, { items: [cmd] });
  }

  async updateOfferQuantities(
    connectionId: string,
    cmd: UpdateOfferQuantitiesBatchCommand
  ): Promise<UpdateOfferQuantitiesBatchResult> {
    if (!cmd.items || cmd.items.length === 0) {
      return { succeeded: [], failed: [] };
    }

    // #1844 / #2323 — the destination's publish Controls (today: the
    // per-connection stock safety buffer) are applied by the availability seam,
    // which is now their sole owner. Resolved BEFORE the adapter is built so an
    // unresolvable Control costs no marketplace call.
    //
    // Note the batch has no variant authority to ask about: neither
    // `UpdateOfferQuantityCommand` nor its payload carries a `productVariantId`,
    // so the quantity is the caller's and only the Controls come from the seam.
    // Threading the variant id (and with it real available-to-promise) is
    // #2324's declared work; this slice deliberately changes no number.
    // The BATCH form, deliberately: the per-item form issues one connection
    // read per ITEM for a value that cannot vary within the batch, where the
    // pre-#2323 code did one read per batch. Same arithmetic, same numbers.
    const controls = await this.availabilityService.applyPublishControlsBatch({
      quantities: cmd.items.map((i) => i.quantity),
      scope: { kind: 'channel', connectionId },
    });

    // ADR-061: `unknown` means OpenLinker could not resolve the Controls. Write
    // NOTHING — not the unbuffered quantity, which would publish straight
    // through the operator's oversell cushion. The batch fails wholesale
    // (`failed` non-empty), which the worker handler turns into a
    // SyncJobExecutionError and retries; a partial write would leave some
    // offers buffered and others not, with nothing recording which.
    const unknown = controls.find((c) => c.provenance === 'unknown');
    if (unknown) {
      this.logger.error(
        `inventory_writeback_suppressed_availability_unknown connection=${connectionId} ` +
          `offers=${cmd.items.length} — publish Controls could not be resolved; no marketplace ` +
          `call was made`
      );
      return {
        succeeded: [],
        failed: cmd.items.map((i) => ({
          offerId: i.offerId,
          errorCode: 'availability_unknown',
          message:
            'Publish controls could not be resolved for this connection; the quantity write was ' +
            'suppressed rather than published without the configured stock safety buffer.',
        })),
      };
    }

    const marketplace = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
      connectionId,
      'OfferManager'
    );

    const normalized: UpdateOfferQuantitiesBatchCommand = {
      idempotencyKey: cmd.idempotencyKey,
      items: cmd.items.map((i, index) => {
        // Non-null: every `unknown` arm returned above, and the seam's contract
        // is `quantity === null` iff `provenance === 'unknown'`.
        const quantity = controls[index].quantity as number;
        if (!i.idempotencyKey && !i.observedAt) {
          // #2285 — a quantity-only key cannot distinguish two writes of the same
          // value, so a corrective write is swallowed by the destination's command-id
          // dedup. Keep the legacy key (nothing else to derive from) but make the
          // degradation observable rather than silent.
          this.logger.warn(
            `inventory_quantity_key_unversioned connection=${connectionId} offer=${i.offerId} quantity=${quantity}`
          );
        }
        return {
          ...i,
          quantity,
          idempotencyKey:
            i.idempotencyKey ??
            this.buildIdempotencyKey(connectionId, i.offerId, quantity, i.observedAt),
        };
      }),
    };

    // Prefer adapter batch API when available and we have more than one item.
    if (isOfferQuantityBatchUpdater(marketplace) && normalized.items.length > 1) {
      try {
        return await marketplace.updateOfferQuantitiesBatch(normalized);
      } catch (error) {
        // Fall back to per-item to allow partial progress if batch fails.
        this.logger.warn(
          `Batch offer quantity update failed, falling back to per-item updates: ${(error as Error).message}`
        );
      }
    }

    const result: UpdateOfferQuantitiesBatchResult = { succeeded: [], failed: [] };

    for (const item of normalized.items) {
      try {
        await marketplace.updateOfferQuantity(item);
        result.succeeded.push(item.offerId);
      } catch (error) {
        result.failed.push({
          offerId: item.offerId,
          errorCode: 'unknown',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }

  /**
   * Deterministic, compact idempotency key over the 4-tuple
   * `(connectionId, offerId, quantity, observedAt)`. The observation token is what
   * lets two writes of the same quantity be told apart (#2285); with no token the
   * key degrades to the pre-#2285 quantity-only form, marked `unversioned`.
   *
   * Never derives from wall-clock time — see `UpdateOfferQuantityCommand.observedAt`.
   */
  private buildIdempotencyKey(
    connectionId: string,
    offerId: string,
    quantity: number,
    observedAt?: string
  ): string {
    // Deterministic, compact idempotency key (avoid long hashes).
    const raw = `inventory:${connectionId}:${offerId}:${quantity}:${observedAt ?? 'unversioned'}`;
    const digest = createHash('sha256').update(raw).digest('hex').slice(0, 16);
    return `inv:${digest}`;
  }
}
