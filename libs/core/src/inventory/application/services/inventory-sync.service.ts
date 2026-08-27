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
import { ISyncCursorsService, SyncLockPort } from '@openlinker/core/sync';
import { SYNC_CURSORS_SERVICE_TOKEN, SYNC_LOCK_TOKEN } from '@openlinker/core/sync';
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
import {
  OFFER_QUANTITY_WRITE_LOCK_TTL_MS,
  isWritableQuantityObservation,
  offerQuantityObservationCursorKey,
  offerQuantityWriteLockKey,
} from '../../domain/types/offer-quantity-write-order.types';
import type { IInventorySyncService } from './inventory-sync.service.interface';
import { Logger } from '@openlinker/shared/logging';

@Injectable()
export class InventorySyncService implements IInventorySyncService {
  private readonly logger = new Logger(InventorySyncService.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connectionPort: ConnectionPort,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly syncLock: SyncLockPort,
    @Inject(SYNC_CURSORS_SERVICE_TOKEN)
    private readonly syncCursors: ISyncCursorsService
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
        return {
          ...i,
          quantity,
          idempotencyKey:
            i.idempotencyKey ?? this.buildIdempotencyKey(connectionId, i.offerId, quantity),
        };
      }),
    };

    // The write-order guard (#2617) serialises and compares per offer, which the
    // adapter batch API has no seam for, so an observed batch takes the per-item
    // path. Correctness beats one round trip here: a lost stock update oversells.
    const hasObservation = normalized.items.some((i) => typeof i.observedAt === 'string');

    // Prefer adapter batch API when available and we have more than one item.
    if (!hasObservation && isOfferQuantityBatchUpdater(marketplace) && normalized.items.length > 1) {
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
        await this.writeOne(connectionId, marketplace, item, result);
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
   * Write one offer's quantity, ordered per offer when the caller quoted an
   * observation (#2617).
   *
   * Order matters twice, so both are handled here. The lock makes read-compare-
   * write atomic and keeps a single marketplace call in flight per offer; the
   * mark decides which of two writes is allowed through. The mark advances only
   * AFTER a successful write, so a refusal always means a strictly newer
   * quantity is already live on the channel - a failed newer write cannot lock
   * an older one out.
   */
  private async writeOne(
    connectionId: string,
    marketplace: OfferManagerPort,
    item: UpdateOfferQuantityCommand,
    result: UpdateOfferQuantitiesBatchResult
  ): Promise<void> {
    const observedAt = item.observedAt;
    if (typeof observedAt !== 'string') {
      await marketplace.updateOfferQuantity(item);
      result.succeeded.push(item.offerId);
      return;
    }

    const lockKey = offerQuantityWriteLockKey(connectionId, item.offerId);
    const token = await this.syncLock.acquire(lockKey, OFFER_QUANTITY_WRITE_LOCK_TTL_MS);
    if (token === null) {
      // A peer holds the offer. Report it so the job retries with backoff and
      // re-evaluates against the mark the peer is about to write; swallowing it
      // would drop this quantity silently.
      result.failed.push({
        offerId: item.offerId,
        errorCode: 'write_contended',
        message: `Another quantity write for offer ${item.offerId} is in flight`,
      });
      return;
    }

    const cursorKey = offerQuantityObservationCursorKey(item.offerId);
    try {
      const lastWritten = await this.syncCursors.getCursor(connectionId, cursorKey);
      if (!isWritableQuantityObservation(observedAt, lastWritten)) {
        this.logger.debug(
          `offer_quantity_write_superseded connection=${connectionId} offer=${item.offerId} ` +
            `observed=${observedAt} lastWritten=${lastWritten ?? 'none'}`
        );
        // Nothing to do rather than a failure: the channel already carries a
        // newer quantity, so this job's work is done.
        result.succeeded.push(item.offerId);
        return;
      }

      await marketplace.updateOfferQuantity(item);
      await this.syncCursors.advanceCursor(connectionId, cursorKey, observedAt);
      result.succeeded.push(item.offerId);
    } finally {
      await this.syncLock.release(lockKey, token);
    }
  }

  private buildIdempotencyKey(connectionId: string, offerId: string, quantity: number): string {
    // Deterministic, compact idempotency key (avoid long hashes).
    const raw = `inventory:${connectionId}:${offerId}:${quantity}`;
    const digest = createHash('sha256').update(raw).digest('hex').slice(0, 16);
    return `inv:${digest}`;
  }
}
