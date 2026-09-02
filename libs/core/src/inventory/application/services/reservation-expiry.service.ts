/**
 * Reservation Expiry Service (#2346, REVIEW § 3 C1, design § 4.2 amendment 3)
 *
 * The state-dependent half of reservation expiry: a hold past `expiresAt` is
 * released **only** when OpenLinker can positively confirm no live OL-executed
 * obligation remains on its order. Anything else extends.
 *
 * That asymmetry is the whole design. A naive sweep releases a fraud-held
 * order's reservation, republishes stock that is still promised, and the later
 * dispatch oversells — silently, with every counter internally consistent.
 *
 * Two invariants worth stating where the code is:
 *
 * - **`releaseHeld` is the only thing that stops a hold counting.** The ATP
 *   subtraction (#2345) filters `status = 'held'`, so the moment a row flips to
 *   `expired` the next propagation publishes the higher number. That is exactly
 *   why the obligation check gates the RELEASE and not some later publish.
 * - **`atpEffect` is never rewritten.** Extension touches `expiresAt` alone.
 *
 * On this branch the pass **releases nothing**: the only obligation kind is an
 * open order hold, whose table (#2339) does not exist, so every verdict is
 * `'indeterminate'` and every candidate is extended. See
 * {@link UnavailableOrderHoldReader}. That is the deliberate fail-closed
 * posture, and the age escalation below is what keeps it from being invisible.
 *
 * @module libs/core/src/inventory/application/services
 * @implements {IReservationExpiryService}
 * @see docs/architecture/adrs/061-advisory-reservations-and-availability-authority.md
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import {
  RESERVATION_OBLIGATION_READERS_TOKEN,
  RESERVATION_REPOSITORY_TOKEN,
} from '../../inventory.tokens';
import { ReservationRepositoryPort } from '../../domain/ports/reservation-repository.port';
import type { Reservation } from '../../domain/entities/reservation.entity';
import type {
  ObligationVerdict,
} from '../../domain/types/reservation-obligation.types';
import { resolveObligation ,
  ObligationReaders} from '../../domain/types/reservation-obligation.types';
import {
  readReservationObligationMaxAgeMs,
  readReservationTtlMs,
  resolveReservationExpiry,
} from '../../domain/types/reservation-expiry.types';
import type {
  ExpireReservationsInput,
  ExpireReservationsResult,
  IReservationExpiryService,
} from './reservation-expiry.service.interface';

@Injectable()
export class ReservationExpiryService implements IReservationExpiryService {
  private readonly logger = new Logger(ReservationExpiryService.name);

  constructor(
    @Inject(RESERVATION_REPOSITORY_TOKEN)
    private readonly reservations: ReservationRepositoryPort,
    @Inject(RESERVATION_OBLIGATION_READERS_TOKEN)
    private readonly obligations: ObligationReaders
  ) {}

  async expireDueReservations(
    input: ExpireReservationsInput
  ): Promise<ExpireReservationsResult> {
    const now = input.now ?? new Date();

    const candidates = await this.reservations.listHeldExpiredBefore(now, input.limit);
    if (candidates.length === 0) {
      return { examined: 0, released: 0, extended: 0, escalated: 0, failed: 0 };
    }

    // Resolved ONCE per run so every hold extended in this run moves to the same
    // instant — two candidates in one page cannot disagree about "now".
    const extendedTo = resolveReservationExpiry(now, readReservationTtlMs(process.env));
    const maxAgeMs = readReservationObligationMaxAgeMs(process.env);

    let released = 0;
    let extended = 0;
    let escalated = 0;
    let failed = 0;

    for (const reservation of candidates) {
      try {
        const verdict = await resolveObligation(this.obligations, reservation.orderRecordId);

        if (verdict === 'absent') {
          // The ONLY release path, and only on a positively confirmed absence.
          await this.reservations.releaseHeld({
            orderRecordId: reservation.orderRecordId,
            orderLineId: reservation.orderLineId,
            inventoryItemId: reservation.inventoryItemId,
            terminalStatus: 'expired',
          });
          released += 1;
          continue;
        }

        await this.reservations.extendHeldExpiry({
          orderRecordId: reservation.orderRecordId,
          orderLineId: reservation.orderLineId,
          inventoryItemId: reservation.inventoryItemId,
          expiresAt: extendedTo,
        });
        extended += 1;

        if (this.isStuck(reservation, now, maxAgeMs)) {
          escalated += 1;
          this.warnStuck(reservation, verdict, now);
        }
      } catch (error) {
        // Per-candidate, never fatal: one bad row must not abort a run that can
        // still safely handle the rest of its page. The row keeps its state and
        // is re-read next tick, because the candidate set is a predicate rather
        // than an offset — nothing is skipped by failing here.
        failed += 1;
        this.logger.error(
          `reservation_expiry_candidate_failed order=${reservation.orderRecordId} ` +
            `line=${reservation.orderLineId} position=${reservation.inventoryItemId}`,
          (error as Error).stack
        );
      }
    }

    if (failed === candidates.length && candidates.length > 0) {
      // EVERY candidate failed. This matters more here than it would in an
      // offset-paged sweep, and the reason is structural: the candidate set is
      // a predicate ordered oldest-overdue-first, and a row is only removed
      // from it by being successfully extended or released. A row that fails
      // PERMANENTLY therefore keeps its old `expiresAt`, stays at the head of
      // that ordering, and is re-read every tick — so enough of them fill the
      // page and the sweep stops reaching anything else (#2330's returns sweep
      // solves the same shape with a scan offset, which is unavailable here:
      // an advancing offset over a self-consuming set steps over holds, the
      // very defect this pass's design rejects).
      //
      // Reported rather than worked around, because the honest fixes are to
      // make the write succeed or to remove the row — neither of which a sweep
      // can do about a row it just failed to write. A full-page failure
      // repeating tick after tick is the signal that has happened.
      this.logger.error(
        `reservation_expiry_page_all_failed examined=${String(candidates.length)} — every ` +
          `candidate failed to write. Overdue holds are ordered oldest-first, so a ` +
          `persistently failing row is re-read every tick and can starve the rest of ` +
          `the set. Investigate before the page fills.`
      );
    }

    return { examined: candidates.length, released, extended, escalated, failed };
  }

  /** Older than the age bound, measured from when the hold was first taken. */
  private isStuck(reservation: Reservation, now: Date, maxAgeMs: number): boolean {
    return now.getTime() - reservation.createdAt.getTime() > maxAgeMs;
  }

  /**
   * The stuck-hold signal.
   *
   * A distinct, greppable `error`-level line rather than a persisted operator
   * fact: W2-15's needs-attention reason set does not exist on this branch, and
   * emitting a fact into no sink would make an unhandled condition read as
   * handled. `ExpireReservationsResult.escalated` carries the same number to the
   * job outcome (the `pruneSkipped` precedent) so it is observable without
   * grepping. Wiring it to an operator surface is W2-15's.
   */
  private warnStuck(
    reservation: Reservation,
    verdict: ObligationVerdict,
    now: Date
  ): void {
    const ageDays = Math.floor(
      (now.getTime() - reservation.createdAt.getTime()) / (24 * 60 * 60 * 1000)
    );
    this.logger.error(
      `reservation_expiry_stuck order=${reservation.orderRecordId} ` +
        `line=${reservation.orderLineId} position=${reservation.inventoryItemId} ` +
        `atpEffect=${reservation.atpEffect} verdict=${verdict} ageDays=${ageDays} — ` +
        `the hold has been extended past the obligation age bound because no ` +
        `obligation source could rule one out. It is NOT released (that would ` +
        `republish possibly-promised stock); an operator must resolve the order.`
    );
  }
}
