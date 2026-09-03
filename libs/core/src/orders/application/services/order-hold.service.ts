/**
 * Order Hold Service (#2339, DESIGN §6.3 / §6.4 / §6.6)
 *
 * Places and releases order holds, and is the read seam every hold gate uses.
 *
 * Deliberately thin over #2338's repository: the concurrency story is already
 * settled there by two conditional statements the database adjudicates, so this
 * service adds no lock and does no read-then-act. What it owns is the clock,
 * §6.4's release policy, and the internal-only lifecycle fact — see
 * {@link IOrderHoldService} for why each of those lives here rather than one
 * layer down.
 *
 * **Provided by `OrderHoldsModule`, not `OrdersModule`.** The leaf split exists
 * so the hold seam needs a narrow set of repositories and not the eight-context
 * graph `OrdersModule` pulls in; putting the service anywhere else would spend
 * that split for nothing.
 *
 * **#2340 ended the module's "one repository" posture, deliberately.** A second
 * repository is injected here for `order_records.activeHoldReason` — the
 * denormalised projection of the open hold. Stated rather than left to be
 * discovered: writing the projection is part of PLACING a hold, not a separate
 * workflow, so it hangs off the same two methods; and it is still two local
 * tables in one context, not a sibling-context edge, so the reason the split
 * exists is intact.
 *
 * @module libs/core/src/orders/application/services
 * @implements {IOrderHoldService}
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { HoldReason, OmsLifecycleFact } from '@openlinker/core/order-lifecycle';
import {
  shipmentDispatchLockKey,
  SYNC_LOCK_TOKEN,
  type SyncLockPort,
} from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';
import type { OrderHold } from '../../domain/entities/order-hold.entity';
import { HoldReleaseNotPermittedError } from '../../domain/exceptions/hold-release-not-permitted.error';
import { HoldReleaseNoteRequiredError } from '../../domain/exceptions/hold-release-note-required.error';
import { HoldAlreadyReleasedError } from '../../domain/exceptions/hold-already-released.error';
import { OrderHoldNotFoundError } from '../../domain/exceptions/order-hold-not-found.error';
import { OrderHoldProjectionRepositoryPort } from '../../domain/ports/order-hold-projection-repository.port';
import { OrderHoldRepositoryPort } from '../../domain/ports/order-hold-repository.port';
import {
  ORDER_HOLD_PROJECTION_REPOSITORY_TOKEN,
  ORDER_HOLD_REPOSITORY_TOKEN,
} from '../../orders.tokens';
import type {
  IOrderHoldService,
  OrderHoldTransition,
  PlaceHoldRequest,
  ReleaseHoldRequest,
} from '../interfaces/order-hold.service.interface';

/**
 * TTL for the non-blocking dispatch probe. Short on purpose: the probe releases
 * the key itself, and this is only the ceiling on how long a lost release could
 * stall a genuine dispatch.
 */
const DISPATCH_PROBE_TTL_MS = 1;

/** Empty / whitespace-only operator text is absence, not content. */
function normalizeNote(note: string | null | undefined): string | null {
  if (typeof note !== 'string') {
    return null;
  }
  const trimmed = note.trim();
  return trimmed.length > 0 ? trimmed : null;
}

@Injectable()
export class OrderHoldService implements IOrderHoldService {
  private readonly logger = new Logger(OrderHoldService.name);

  constructor(
    @Inject(ORDER_HOLD_REPOSITORY_TOKEN)
    private readonly holds: OrderHoldRepositoryPort,
    @Inject(ORDER_HOLD_PROJECTION_REPOSITORY_TOKEN)
    private readonly projection: OrderHoldProjectionRepositoryPort,
    // Optional so a graph without `SyncModule` (and every existing unit spec)
    // still constructs. Absent means "cannot tell", which reports as no
    // overlap — never as a refusal.
    @Optional()
    @Inject(SYNC_LOCK_TOKEN)
    private readonly locks?: SyncLockPort
  ) {}

  async place(request: PlaceHoldRequest): Promise<OrderHoldTransition> {
    const hold = await this.holds.placeIfNoneOpen({
      internalOrderId: request.internalOrderId,
      reason: request.reason,
      note: normalizeNote(request.note),
      placedBy: request.placedBy,
      placedAt: new Date(),
    });

    await this.projectActiveHoldReason(hold.internalOrderId, hold.reason);

    const dispatchInFlight = await this.detectDispatchInFlight(
      hold.internalOrderId,
      hold.id
    );

    return this.emit(
      hold,
      {
        type: 'held',
        internalOrderId: hold.internalOrderId,
        reason: hold.reason,
      },
      dispatchInFlight
    );
  }

  async release(request: ReleaseHoldRequest): Promise<OrderHoldTransition> {
    const note = normalizeNote(request.note);

    // Read before write, for the POLICY only — never for the concurrency
    // outcome, which stays the conditional UPDATE's to decide. A hold released
    // between this read and that statement still produces
    // `HoldAlreadyReleasedError`; the read merely lets the two policy refusals
    // happen before anything is stamped, so a rejected release leaves no trace
    // of having half-happened.
    const existing = await this.holds.findById(request.holdId);
    if (!existing) {
      throw new OrderHoldNotFoundError(request.holdId);
    }
    if (!existing.isOpen()) {
      // `releasedAt` is non-null exactly when `isOpen()` is false — the entity's
      // own predicate, so the assertion cannot drift from the branch.
      throw new HoldAlreadyReleasedError(
        request.holdId,
        existing.releasedAt as Date
      );
    }

    this.assertReleaseAllowed(existing, request, note);

    const hold = await this.holds.releaseHeld({
      holdId: request.holdId,
      releasedAt: new Date(),
      releaseNote: note,
      // Null for a service release: `order_holds` records a releasing USER or
      // nobody. A releasing service is identified by the fact that it placed
      // the hold — the only service the policy above admits — so there is no
      // second identity to store and no `releasedByService` column invented for
      // one.
      releasedByUserId:
        request.releasedBy.kind === 'user' ? request.releasedBy.userId : null,
    });

    // `null`, not "skip": the projection is level-triggered, so storing null is
    // what CLEARS the stale reason (#2100's rule).
    await this.projectActiveHoldReason(hold.internalOrderId, null);

    return this.emit(
      hold,
      {
        type: 'released',
        internalOrderId: hold.internalOrderId,
        reason: hold.reason,
      },
      false
    );
  }

  async getOpenHold(internalOrderId: string): Promise<OrderHold | null> {
    return this.holds.findOpenByOrder(internalOrderId);
  }

  async listHolds(internalOrderId: string): Promise<OrderHold[]> {
    return this.holds.listByOrder(internalOrderId);
  }

  /**
   * §6.4: a service-placed hold is released by the placing service, or by a
   * human with a mandatory note.
   *
   * Two rules, in the order a reader should hold them:
   *
   * - **A service may release only the hold it placed itself.** That covers a
   *   peer service AND a user-placed hold — see
   *   {@link HoldReleaseNotPermittedError} for why the second case, which §6.4
   *   leaves unstated, resolves to a refusal rather than to permission.
   * - **A user may release anything, and owes a note when overruling a
   *   service.** The human escape hatch is never closed; it is priced.
   */
  private assertReleaseAllowed(
    hold: OrderHold,
    request: ReleaseHoldRequest,
    note: string | null
  ): void {
    const placedByService = hold.placedByService;

    if (request.releasedBy.kind === 'service') {
      if (
        placedByService === null ||
        request.releasedBy.service !== placedByService
      ) {
        throw new HoldReleaseNotPermittedError(
          hold.id,
          placedByService,
          request.releasedBy.service
        );
      }
      return;
    }

    if (placedByService !== null && note === null) {
      throw new HoldReleaseNoteRequiredError(hold.id, placedByService);
    }
  }

  /**
   * Write the denormalised `order_records.activeHoldReason` cache (#2340).
   *
   * **Best-effort, and it never throws.** The hold itself is the authority and
   * has already committed; failing `place()` here would leave the operator with
   * neither a hold nor a projection, which is strictly worse than a badge that
   * is stale until the next `orders.holds.reconcile` tick. That reconcile is
   * precisely why this may be best-effort rather than belt-and-braces.
   *
   * The log token is stable and greppable on purpose: it is the ONLY signal
   * anyone gets that a phase badge is stale for up to one cron interval, which
   * is what makes "hourly is enough" an accepted cost rather than an invisible
   * one. It is alertable — keep it.
   *
   * No `ifCurrentlyIs`: this path IS the authority and must not be conditional
   * on whatever a stale reconcile left behind.
   */
  private async projectActiveHoldReason(
    internalOrderId: string,
    reason: HoldReason | null
  ): Promise<void> {
    try {
      await this.projection.setActiveHoldReason(internalOrderId, reason);
    } catch (error) {
      this.logger.warn(
        `order_hold_projection_write_failed for order ${internalOrderId}: ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Log the fact and hand it back.
   *
   * There is no publish. `OmsLifecycleFact` is the internal-only half of §6.6's
   * split, and neither `held` nor `released` is a member of the relay
   * `OrderLifecycleEvent` union — so no `OrderStatusWriteback` adapter can be
   * asked to express a warehouse fact it has no verb for.
   */
  private emit(
    hold: OrderHold,
    fact: OmsLifecycleFact,
    dispatchInFlight: boolean
  ): OrderHoldTransition {
    this.logger.log(
      `OMS lifecycle fact '${fact.type}' for order ${hold.internalOrderId} ` +
        `(hold ${hold.id}, reason '${hold.reason}')`
    );
    return { hold, fact, dispatchInFlight };
  }

  /**
   * Was a dispatch of this order in flight when the hold landed?
   *
   * **Non-blocking, and it never changes the outcome of `place()`.** The probe
   * is an `acquire` of the SAME per-order key `ShipmentDispatchService` holds
   * across its carrier round-trip, released immediately: acquired means no
   * dispatch was running, refused means one was. Holding it would serialize a
   * hold behind a multi-second label call for no benefit, and failing the hold
   * on contention would refuse to stop an order because it is busy shipping —
   * exactly backwards.
   *
   * The hold is already committed by the time this runs, so a `true` here is a
   * report, never a gate. The carrier call cannot be recalled; what this closes
   * is the SILENCE — an operator otherwise finds a hold badge over a parcel that
   * shipped anyway, with nothing anywhere saying the two overlapped.
   *
   * A TTL of one millisecond is used deliberately: the probe must not leave a
   * key behind that could stall a real dispatch if the release call is lost.
   */
  private async detectDispatchInFlight(
    internalOrderId: string,
    holdId: string
  ): Promise<boolean> {
    if (!this.locks) {
      return false;
    }

    const key = shipmentDispatchLockKey(internalOrderId);
    try {
      const token = await this.locks.acquire(key, DISPATCH_PROBE_TTL_MS);
      if (token === null) {
        this.logger.warn(
          `order_hold_placed_during_dispatch for order ${internalOrderId} ` +
            `(hold ${holdId}): a dispatch was in flight, so a label may already ` +
            `have been minted for this order — the hold cannot recall it`
        );
        return true;
      }
      await this.locks.release(key, token);
      return false;
    } catch (error) {
      // "Cannot tell" reports as no overlap. Asserting one on a Redis blip
      // would tell the operator a parcel may have shipped when nothing says so.
      this.logger.warn(
        `order_hold_dispatch_probe_failed for order ${internalOrderId}: ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }
}
