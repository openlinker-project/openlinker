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
 * so the hold seam needs one repository and not the eight-context graph
 * `OrdersModule` pulls in; putting the service anywhere else would spend that
 * split for nothing.
 *
 * @module libs/core/src/orders/application/services
 * @implements {IOrderHoldService}
 */
import { Inject, Injectable } from '@nestjs/common';
import type { OmsLifecycleFact } from '@openlinker/core/order-lifecycle';
import { Logger } from '@openlinker/shared/logging';
import type { OrderHold } from '../../domain/entities/order-hold.entity';
import { HoldReleaseNotPermittedError } from '../../domain/exceptions/hold-release-not-permitted.error';
import { HoldReleaseNoteRequiredError } from '../../domain/exceptions/hold-release-note-required.error';
import { HoldAlreadyReleasedError } from '../../domain/exceptions/hold-already-released.error';
import { OrderHoldNotFoundError } from '../../domain/exceptions/order-hold-not-found.error';
import { OrderHoldRepositoryPort } from '../../domain/ports/order-hold-repository.port';
import { ORDER_HOLD_REPOSITORY_TOKEN } from '../../orders.tokens';
import type {
  IOrderHoldService,
  OrderHoldTransition,
  PlaceHoldRequest,
  ReleaseHoldRequest,
} from '../interfaces/order-hold.service.interface';

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
    private readonly holds: OrderHoldRepositoryPort
  ) {}

  async place(request: PlaceHoldRequest): Promise<OrderHoldTransition> {
    const hold = await this.holds.placeIfNoneOpen({
      internalOrderId: request.internalOrderId,
      reason: request.reason,
      note: normalizeNote(request.note),
      placedBy: request.placedBy,
      placedAt: new Date(),
    });

    return this.emit(hold, {
      type: 'held',
      internalOrderId: hold.internalOrderId,
      reason: hold.reason,
    });
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

    return this.emit(hold, {
      type: 'released',
      internalOrderId: hold.internalOrderId,
      reason: hold.reason,
    });
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
   * Log the fact and hand it back.
   *
   * There is no publish. `OmsLifecycleFact` is the internal-only half of §6.6's
   * split, and neither `held` nor `released` is a member of the relay
   * `OrderLifecycleEvent` union — so no `OrderStatusWriteback` adapter can be
   * asked to express a warehouse fact it has no verb for.
   */
  private emit(hold: OrderHold, fact: OmsLifecycleFact): OrderHoldTransition {
    this.logger.log(
      `OMS lifecycle fact '${fact.type}' for order ${hold.internalOrderId} ` +
        `(hold ${hold.id}, reason '${hold.reason}')`
    );
    return { hold, fact };
  }
}
