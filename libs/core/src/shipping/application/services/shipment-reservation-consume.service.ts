/**
 * Shipment Reservation Consume Service (#2347, REVIEW § 3 C8)
 *
 * Closes the held reservations of orders whose goods have shipped, exactly
 * once per shipment, via a `Shipment.reservationConsumedAt` claim.
 *
 * The contract — why this is a sweep, why it consumes before it claims, and why
 * consume is order-scoped — is documented once on
 * {@link IShipmentReservationConsumeService}. Read that first; this file is the
 * mechanism.
 *
 * @module libs/core/src/shipping/application/services
 * @implements {IShipmentReservationConsumeService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import {
  RESERVATION_SERVICE_TOKEN,
  type IReservationService,
} from '@openlinker/core/inventory';

import { SHIPMENT_REPOSITORY_TOKEN } from '../../shipping.tokens';
import { ShipmentRepositoryPort } from '../../domain/ports/shipment-repository.port';
import type {
  ConsumeShipmentReservationsInput,
  ConsumeShipmentReservationsResult,
  IShipmentReservationConsumeService,
} from './shipment-reservation-consume.service.interface';

@Injectable()
export class ShipmentReservationConsumeService implements IShipmentReservationConsumeService {
  private readonly logger = new Logger(ShipmentReservationConsumeService.name);

  constructor(
    @Inject(SHIPMENT_REPOSITORY_TOKEN)
    private readonly shipments: ShipmentRepositoryPort,
    @Inject(RESERVATION_SERVICE_TOKEN)
    private readonly reservations: IReservationService
  ) {}

  async consumeDueShipments(
    input: ConsumeShipmentReservationsInput
  ): Promise<ConsumeShipmentReservationsResult> {
    const now = input.now ?? new Date();

    const candidates = await this.shipments.listDispatchedAwaitingReservationConsume(input.limit);
    if (candidates.length === 0) {
      return {
        examined: 0,
        consumed: 0,
        reservationsConsumed: 0,
        alreadyTerminal: 0,
        skipped: 0,
        failed: 0,
      };
    }

    let consumed = 0;
    let reservationsConsumed = 0;
    let alreadyTerminal = 0;
    let skipped = 0;
    let failed = 0;

    for (const shipment of candidates) {
      try {
        // CONSUME FIRST. The ledger's `status = 'held'` guard is what makes the
        // decrement exactly-once, so running it before the claim costs nothing
        // and buys crash-safety: a kill before the claim below leaves this
        // shipment a candidate, and the next tick's repeat decrements nothing.
        const result = await this.reservations.closeForOrder({
          orderRecordId: shipment.orderId,
          terminalStatus: 'consumed',
        });
        reservationsConsumed += result.closed;
        alreadyTerminal += result.alreadyTerminal;

        if (result.failed > 0) {
          // The order is not fully closed, so the marker must NOT be claimed —
          // claiming it would retire the shipment from the candidate set with
          // live holds still standing, which is the leak this pass exists to
          // prevent. Leaving the marker NULL is what makes the next tick retry.
          failed += 1;
          this.logger.error(
            `shipment_reservation_consume_incomplete shipment=${shipment.id} ` +
              `order=${shipment.orderId} failedRows=${String(result.failed)} — marker NOT ` +
              `claimed; the next tick will retry`
          );
          continue;
        }

        // CLAIM SECOND, and only now: every hold on this order is terminal.
        const claimed = await this.shipments.claimReservationConsume(shipment.id, now);
        if (!claimed) {
          // A peer marked it between our read and this write. Its consume did
          // the same work ours did; nothing was double-decremented.
          skipped += 1;
          continue;
        }
        consumed += 1;
      } catch (error) {
        // Per-candidate, never fatal: one bad shipment must not abort a run that
        // can still safely handle the rest of its page. Nothing is persisted on
        // this path — there is no cursor — so the candidate keeps its NULL
        // marker and is re-read next tick.
        failed += 1;
        this.logger.error(
          `shipment_reservation_consume_failed shipment=${shipment.id} ` +
            `order=${shipment.orderId}`,
          (error as Error).stack
        );
      }
    }

    if (failed === candidates.length) {
      // EVERY candidate failed. This matters structurally, not just
      // statistically: the candidate set is a predicate ordered
      // `createdAt ASC`, and a row leaves it only by being successfully
      // consumed. A row that fails PERMANENTLY therefore keeps its NULL marker,
      // stays at the head of that ordering, and is re-read every tick — so
      // enough of them fill the page and the sweep stops reaching anything
      // else. #2346's expiry pass reports the same shape for the same reason.
      this.logger.error(
        `shipment_reservation_consume_page_all_failed examined=${String(candidates.length)} — ` +
          `every candidate failed. Candidates are ordered oldest-first, so a persistently ` +
          `failing row is re-read every tick and can starve the rest of the set. Investigate ` +
          `before the page fills.`
      );
    }

    return {
      examined: candidates.length,
      consumed,
      reservationsConsumed,
      alreadyTerminal,
      skipped,
      failed,
    };
  }
}
