/**
 * Master-Absorbed Reservation Service
 *
 * Consumes the advisory holds a product master has absorbed: once an order is
 * created at a destination that is also the master owning the reserved
 * position, that master lowers its own stock, and the next read of it puts the
 * sale into `availableQuantity`. A `published` hold for the same units then
 * subtracts them a second time (ANALYSIS-1032 § 6 C3a). C3a bounded that window
 * to "dispatch until the next master sync" on the premise that OpenLinker never
 * observes the master's decrement - but here OpenLinker AUTHORED it, by creating
 * the order there, so the window would otherwise run from order creation until
 * dispatch.
 *
 * ## Which holds, and why each rule
 *
 * - **`published` only.** A `diagnostic` hold subtracts nothing (#2345), so
 *   closing it would change no number and only rewrite why it ended.
 * - **Owner must be EXACTLY the destination.** Read from the position's own
 *   `sourceConnectionId`, the same provenance the routed-order sale decrement
 *   (#3453) acts on. A position owned by another master stays held: that master
 *   did not receive this order and its stock has not moved.
 * - **`NULL` / `'legacy'` provenance stays held.** OpenLinker cannot name that
 *   position's owner, and closing a hold whose master did NOT decrement would
 *   publish units that are already promised. Keeping it costs an under-sell
 *   until dispatch - the pre-fix behaviour, never an oversell - and it is
 *   counted and logged so it is not silent. A master sync stamps its own
 *   provenance on the row it writes, so the case shrinks on its own.
 * - **A position that is no longer live stays held.** Its hold already
 *   subtracts nothing, because the ATP read excludes stale positions.
 *
 * ## Why `consumed`
 *
 * The ledger records WHY a promise ended. `released` means the order gave its
 * promise back (cancellation, #2348) and `expired` that it timed out (#2346);
 * neither is true here. `consumed` is what the routed-order decrement already
 * writes when the reduction "moves from the hold to the master" (#3480), which
 * is exactly this event, so a new status would only split one meaning across
 * two values and need a migration for it.
 *
 * @module libs/core/src/inventory/application/services
 * @implements {IMasterAbsorbedReservationService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { SYNC_JOB_QUEUE_TOKEN, type SyncJobQueuePort } from '@openlinker/core/sync';

import type { Reservation } from '../../domain/entities/reservation.entity';
import { InventoryRepositoryPort } from '../../domain/ports/inventory-repository.port';
import { ReservationRepositoryPort } from '../../domain/ports/reservation-repository.port';
import {
  LEGACY_SOURCE_CONNECTION_ID,
  type InventoryOwnerPosition,
} from '../../domain/types/inventory.types';
import {
  INVENTORY_REPOSITORY_TOKEN,
  RESERVATION_REPOSITORY_TOKEN,
  RESERVATION_SERVICE_TOKEN,
} from '../../inventory.tokens';
import type {
  ConsumeAbsorbedHoldsInput,
  ConsumeAbsorbedHoldsResult,
  IMasterAbsorbedReservationService,
} from './master-absorbed-reservation.service.interface';
import { IReservationService } from './reservation.service.interface';

/** Why one held row is or is not this master's to consume. */
type RowVerdict = 'candidate' | 'diagnostic' | 'unknown-position' | 'unattributed' | 'other-owner';

const ZERO_RESULT: ConsumeAbsorbedHoldsResult = {
  closed: 0,
  alreadyTerminal: 0,
  failed: 0,
  keptUnattributed: 0,
  keptOtherOwner: 0,
  keptUnknownPosition: 0,
  keptDiagnostic: 0,
  keptSharedLine: 0,
  propagationsEnqueued: 0,
};

@Injectable()
export class MasterAbsorbedReservationService implements IMasterAbsorbedReservationService {
  private readonly logger = new Logger(MasterAbsorbedReservationService.name);

  constructor(
    @Inject(RESERVATION_REPOSITORY_TOKEN)
    private readonly reservationRepository: ReservationRepositoryPort,
    @Inject(INVENTORY_REPOSITORY_TOKEN)
    private readonly inventoryRepository: InventoryRepositoryPort,
    @Inject(RESERVATION_SERVICE_TOKEN)
    private readonly reservations: IReservationService,
    @Inject(SYNC_JOB_QUEUE_TOKEN)
    private readonly jobQueue: SyncJobQueuePort
  ) {}

  async consumeAbsorbedHolds(
    input: ConsumeAbsorbedHoldsInput
  ): Promise<ConsumeAbsorbedHoldsResult> {
    const held = await this.reservationRepository.listHeldByOrderRecordId(input.orderRecordId);
    // The common case on every re-poll of an order whose holds are already
    // closed (or that never held): one read, no position lookup.
    if (held.length === 0) {
      return ZERO_RESULT;
    }

    const productIds = [...new Set(input.productIds.filter((id) => id !== ''))];
    const positions = await this.inventoryRepository.findLiveOwnerPositions(productIds);
    const positionById = new Map(positions.map((p) => [p.inventoryItemId, p]));

    const verdicts = held.map((row) => ({
      row,
      verdict: this.classify(row, positionById, input.masterConnectionId),
    }));

    // The close is line-scoped (`closeForOrder`'s `orderLineIds`), so a line is
    // closable only when EVERY held row on it is this master's. Two held rows on
    // one line means the line re-resolved to a second position; closing it by
    // line would also close the hold that must stay.
    const rowsByLine = new Map<string, RowVerdict[]>();
    for (const { row, verdict } of verdicts) {
      const bucket = rowsByLine.get(row.orderLineId);
      if (bucket) bucket.push(verdict);
      else rowsByLine.set(row.orderLineId, [verdict]);
    }
    const closableLines = new Set(
      [...rowsByLine.entries()]
        .filter(([, lineVerdicts]) => lineVerdicts.every((v) => v === 'candidate'))
        .map(([lineId]) => lineId)
    );

    let keptUnattributed = 0;
    let keptOtherOwner = 0;
    let keptUnknownPosition = 0;
    let keptDiagnostic = 0;
    let keptSharedLine = 0;
    for (const { row, verdict } of verdicts) {
      if (verdict === 'candidate') {
        if (!closableLines.has(row.orderLineId)) keptSharedLine += 1;
        continue;
      }
      if (verdict === 'unattributed') keptUnattributed += 1;
      else if (verdict === 'other-owner') keptOtherOwner += 1;
      else if (verdict === 'unknown-position') keptUnknownPosition += 1;
      else keptDiagnostic += 1;
    }

    if (keptUnattributed > 0) {
      this.logger.warn(
        `reservation_absorbed_hold_kept_unattributed order=${input.orderRecordId} ` +
          `master=${input.masterConnectionId} holds=${keptUnattributed} - the reserved position ` +
          'has no named owner, so OpenLinker cannot tell whether this master lowered its stock; ' +
          'the hold stays until dispatch'
      );
    }

    if (closableLines.size === 0) {
      return {
        ...ZERO_RESULT,
        keptUnattributed,
        keptOtherOwner,
        keptUnknownPosition,
        keptDiagnostic,
        keptSharedLine,
      };
    }

    const closeResult = await this.reservations.closeForOrder({
      orderRecordId: input.orderRecordId,
      terminalStatus: 'consumed',
      orderLineIds: [...closableLines],
    });

    let propagationsEnqueued = 0;
    if (input.propagate && closeResult.closed > 0) {
      const targets = verdicts
        .filter(({ row }) => closableLines.has(row.orderLineId))
        .map(({ row }) => positionById.get(row.inventoryItemId))
        .filter((p): p is InventoryOwnerPosition => p !== undefined);
      propagationsEnqueued = await this.enqueuePropagation(input.masterConnectionId, targets);
    }

    this.logger.log(
      `reservation_absorbed_by_master order=${input.orderRecordId} master=${input.masterConnectionId} ` +
        `closed=${closeResult.closed} alreadyTerminal=${closeResult.alreadyTerminal} ` +
        `failed=${closeResult.failed} propagations=${propagationsEnqueued}`
    );

    return {
      closed: closeResult.closed,
      alreadyTerminal: closeResult.alreadyTerminal,
      failed: closeResult.failed,
      keptUnattributed,
      keptOtherOwner,
      keptUnknownPosition,
      keptDiagnostic,
      keptSharedLine,
      propagationsEnqueued,
    };
  }

  private classify(
    row: Reservation,
    positionById: ReadonlyMap<string, InventoryOwnerPosition>,
    masterConnectionId: string
  ): RowVerdict {
    if (row.atpEffect !== 'published') return 'diagnostic';
    const position = positionById.get(row.inventoryItemId);
    if (position === undefined) return 'unknown-position';
    const owner = position.sourceConnectionId;
    if (owner === null || owner === LEGACY_SOURCE_CONNECTION_ID) return 'unattributed';
    return owner === masterConnectionId ? 'candidate' : 'other-owner';
  }

  /**
   * One variant-keyed, location-free propagation per distinct variant, in the
   * shape `MasterInventorySyncService` uses for a change that moves the
   * aggregate without writing a stock row (#2324): closing a hold is exactly
   * that, so `setInventory`'s own enqueue never fires for it.
   *
   * Scoped to the master the stock belongs to (#2609), never the system id, so
   * per-scope lane accounting keeps one master's burst to itself.
   */
  private async enqueuePropagation(
    masterConnectionId: string,
    positions: readonly InventoryOwnerPosition[]
  ): Promise<number> {
    const writeEventToken = new Date().toISOString();
    const variants = new Map<string, { productId: string; variantId: string | null }>();
    for (const position of positions) {
      variants.set(`${position.productId} ${position.productVariantId ?? ''}`, {
        productId: position.productId,
        variantId: position.productVariantId,
      });
    }

    let enqueued = 0;
    for (const { productId, variantId } of variants.values()) {
      try {
        await this.jobQueue.enqueue({
          type: 'inventory.propagateToMarketplaces',
          connectionId: masterConnectionId,
          payload: { productId, variantId, inventoryUpdatedAt: writeEventToken },
          options: {
            dedupeKey: [
              'inventory:propagate',
              productId,
              variantId ?? 'base',
              writeEventToken,
            ].join(':'),
          },
        });
        enqueued += 1;
      } catch (error) {
        // The hold is already closed; only the republish is late, and the next
        // stock change or master sweep publishes from persisted state.
        this.logger.error(
          `reservation_absorbed_propagation_enqueue_failed product=${productId} ` +
            `variant=${variantId ?? 'base'} reason=${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    return enqueued;
  }
}
