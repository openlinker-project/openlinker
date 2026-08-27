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
import { SYNC_CURSORS_SERVICE_TOKEN, SYNC_LOCK_TOKEN } from '@openlinker/core/sync';
import { ISyncCursorsService, SyncLockPort } from '@openlinker/core/sync';
import {
  CONNECTION_PORT_TOKEN,
  ConnectionPort,
  applyStockSafetyBuffer,
  isPresentButInvalidStockSafetyBuffer,
  isPresentButInvalidStockZeroThreshold,
  readStockSafetyBuffer,
  readStockZeroThreshold,
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
          `(non-numeric, negative, or non-finite) — it coerces to 0, so no stock ` +
          `reserve is applied to write-back. Set a positive integer to enable oversell protection.`
      );
    }
    if (isPresentButInvalidStockZeroThreshold(connection.config)) {
      this.logger.warn(
        `Connection ${connectionId} has a stockZeroThreshold that is present but invalid ` +
          `(non-numeric, negative, or non-finite) — it coerces to 0, so no low-stock floor ` +
          `is applied to write-back. Set a positive integer to enable it.`
      );
    }
    const reserve = readStockSafetyBuffer(connection.config);
    const zeroThreshold = readStockZeroThreshold(connection.config);

    const normalized: UpdateOfferQuantitiesBatchCommand = {
      idempotencyKey: cmd.idempotencyKey,
      items: cmd.items.map((i) => {
        const quantity = applyStockSafetyBuffer(i.quantity, reserve, zeroThreshold);
        return {
          ...i,
          quantity,
          idempotencyKey:
            i.idempotencyKey ?? this.buildIdempotencyKey(connectionId, i.offerId, quantity),
        };
      }),
    };

    // Prefer the adapter batch API when available and we have more than one
    // item. The write-order guard (#2617) is applied PER ITEM even here: it
    // locks and compares each observed item first, then hands the survivors to
    // the single batch call, so guarding costs no extra marketplace call
    // (#2617 review). Items with no observation ride along unguarded.
    if (isOfferQuantityBatchUpdater(marketplace) && normalized.items.length > 1) {
      const batched = await this.writeBatch(connectionId, marketplace, normalized);
      if (batched !== null) {
        return batched;
      }
      // Batch call failed - fall through to per-item so a partial batch can
      // still make progress. Locks taken for the batch are already released.
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
   * Write a whole batch through the adapter batch API, guarding each observed
   * item first (#2617 review).
   *
   * Per item: take the offer's lock, read the mark, and drop the item when a
   * newer quantity is already live. Whatever survives goes out in ONE
   * marketplace call, and only the ids the adapter reported as succeeded
   * advance their mark - a failed item must not claim the channel carries its
   * quantity. Locks are held across the call so a peer cannot interleave, and
   * released in `finally`.
   *
   * Returns `null` when the batch call itself threw, so the caller can fall
   * back to per-item writes; the locks are released by then.
   */
  private async writeBatch(
    connectionId: string,
    marketplace: OfferManagerPort & {
      updateOfferQuantitiesBatch(
        cmd: UpdateOfferQuantitiesBatchCommand
      ): Promise<UpdateOfferQuantitiesBatchResult>;
    },
    normalized: UpdateOfferQuantitiesBatchCommand
  ): Promise<UpdateOfferQuantitiesBatchResult | null> {
    const result: UpdateOfferQuantitiesBatchResult = { succeeded: [], failed: [] };
    const writable: UpdateOfferQuantityCommand[] = [];
    const held: { lockKey: string; token: string }[] = [];
    const guarded: { offerId: string; cursorKey: string; observedAt: string }[] = [];

    try {
      for (const item of normalized.items) {
        const observedAt = item.observedAt;
        if (typeof observedAt !== 'string') {
          writable.push(item);
          continue;
        }

        const lockKey = offerQuantityWriteLockKey(connectionId, item.offerId);
        const token = await this.syncLock.acquire(lockKey, OFFER_QUANTITY_WRITE_LOCK_TTL_MS);
        if (token === null) {
          result.failed.push({
            offerId: item.offerId,
            errorCode: 'write_contended',
            message: `Another quantity write for offer ${item.offerId} is in flight`,
          });
          continue;
        }
        held.push({ lockKey, token });

        const cursorKey = offerQuantityObservationCursorKey(item.offerId);
        const lastWritten = await this.syncCursors.getCursor(connectionId, cursorKey);
        if (!isWritableQuantityObservation(observedAt, lastWritten)) {
          this.logger.debug(
            `offer_quantity_write_superseded connection=${connectionId} offer=${item.offerId} ` +
              `observed=${observedAt} lastWritten=${lastWritten ?? 'none'}`
          );
          result.succeeded.push(item.offerId);
          continue;
        }

        writable.push(item);
        guarded.push({ offerId: item.offerId, cursorKey, observedAt });
      }

      if (writable.length === 0) {
        return result;
      }

      let batchResult: UpdateOfferQuantitiesBatchResult;
      try {
        batchResult = await marketplace.updateOfferQuantitiesBatch({
          idempotencyKey: normalized.idempotencyKey,
          items: writable,
        });
      } catch (error) {
        this.logger.warn(
          `Batch offer quantity update failed, falling back to per-item updates: ${(error as Error).message}`
        );
        return null;
      }

      const succeededIds = new Set(batchResult.succeeded);
      for (const entry of guarded) {
        if (succeededIds.has(entry.offerId)) {
          await this.syncCursors.advanceCursorIfNewer(
            connectionId,
            entry.cursorKey,
            entry.observedAt
          );
        }
      }

      result.succeeded.push(...batchResult.succeeded);
      result.failed.push(...batchResult.failed);
      return result;
    } finally {
      for (const lock of held) {
        await this.syncLock.release(lock.lockKey, lock.token);
      }
    }
  }

  /**
   * Write one offer's quantity, ordered per offer when the caller quoted an
   * observation (#2617).
   *
   * Order matters twice, so both are handled here. The lock makes read-compare-
   * write atomic and keeps a single marketplace call in flight per offer; the
   * mark decides which of two writes is allowed through.
   *
   * The mark is advanced with `advanceCursorIfNewer`, a compare-and-set, so
   * monotonicity does not depend on the lock surviving the marketplace call. A
   * call that outran the 30 s TTL used to be able to set the mark BACK to its
   * own older observation after a peer had already written a newer quantity,
   * which then admitted a stale write behind it - the exact defect this guard
   * exists to prevent. The mark still advances only AFTER a successful write,
   * so a refusal always means a strictly newer quantity is already live on the
   * channel.
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
      // A peer holds the offer. Report it so the job comes back and re-evaluates
      // against the mark the peer is about to write; swallowing it would drop
      // this quantity silently. The handler turns an all-contended batch into a
      // ContendedWriteError, which the runner defers penalty-free (#2617
      // review) - contention is the guard working, not the job failing, so it
      // must not burn a retry attempt.
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
      const advanced = await this.syncCursors.advanceCursorIfNewer(
        connectionId,
        cursorKey,
        observedAt
      );
      if (!advanced) {
        // A peer wrote a newer quantity while this call was in flight, so the
        // lock had expired. The write itself is done; the mark must stay where
        // the newer observation put it.
        this.logger.warn(
          `offer_quantity_mark_not_moved connection=${connectionId} offer=${item.offerId} ` +
            `observed=${observedAt}: a newer observation is already marked`
        );
      }
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
