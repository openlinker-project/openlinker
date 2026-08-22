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
import {
  CONNECTION_PORT_TOKEN,
  ConnectionPort,
  applyStockSafetyBuffer,
  isPresentButInvalidStockSafetyBuffer,
  readStockSafetyBuffer,
} from '@openlinker/core/identifier-mapping';
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
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connectionPort: ConnectionPort
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

    const marketplace = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
      connectionId,
      'OfferManager'
    );

    // #1844 — apply the destination's per-connection stock safety buffer to every
    // written-back quantity: published quantity = max(0, masterStock - reserve).
    // Read once per batch (single connection); default reserve 0 => pass-through.
    const connection = await this.connectionPort.get(connectionId);
    if (isPresentButInvalidStockSafetyBuffer(connection.config)) {
      this.logger.warn(
        `Connection ${connectionId} has a stockSafetyBuffer that is present but invalid ` +
          `(non-numeric, negative, zero, or non-finite) — it coerces to 0, so no stock ` +
          `reserve is applied to write-back. Set a positive integer to enable oversell protection.`
      );
    }
    const reserve = readStockSafetyBuffer(connection.config);

    const normalized: UpdateOfferQuantitiesBatchCommand = {
      idempotencyKey: cmd.idempotencyKey,
      items: cmd.items.map((i) => {
        const quantity = applyStockSafetyBuffer(i.quantity, reserve);
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
