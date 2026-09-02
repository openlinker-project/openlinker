/**
 * Fulfillment Dispatch Relay Service (#2401, `W3a-12`)
 *
 * Turns a `dispatch` fulfilment-progress intent into AT MOST ONE lifecycle relay,
 * gated by the `fulfillment_works.dispatchRelayedAt` claim (#2392) and releasing
 * that claim when the relay failed transiently, so a later progress event can
 * re-drive it.
 *
 * This is the work-grain generalisation of #1947's `Shipment.waybillRelayedAt`,
 * and the build-out that answers #861 at WORK grain. What it does not answer:
 * #861's state is per-DESTINATION, this claim is per-WORK, so a relay that
 * succeeds for one participant and fails transiently for another cannot record
 * the asymmetry — retry stays all-or-nothing. #861 stays open for that half.
 *
 * **Nothing calls this in production yet**, consistent with the wave:
 * `IFulfillmentProgressService.record` — which produces the intent this consumes
 * — has no production caller either. #2398's poller is the first for both, so a
 * reader grepping for the consumer today finds only the specs.
 *
 * @module libs/core/src/orders/application/services
 * @implements {IFulfillmentDispatchRelayService}
 * @see #2398 for the first production caller of the progress ingress
 */
import { Inject, Injectable } from '@nestjs/common';

import {
  FULFILLMENT_RELAY_GATE_SERVICE_TOKEN,
  type IFulfillmentRelayGateService,
} from '@openlinker/core/fulfillment';
import { Logger } from '@openlinker/shared/logging';

import type {
  FulfillmentDispatchIntent,
  FulfillmentDispatchRelayOutcome,
  IFulfillmentDispatchRelayService,
} from '../interfaces/fulfillment-dispatch-relay.service.interface';
import {
  IOrderLifecycleRelayService} from '../interfaces/order-lifecycle-relay.service.interface';
import type {
  OrderLifecycleRelayTargetResult,
} from '../interfaces/order-lifecycle-relay.service.interface';
import { ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN } from '../../orders.tokens';

/**
 * A NON-PARTICIPANT sentinel passed as the relay's `originConnectionId`.
 *
 * The `AUTOMATION_RELAY_ORIGIN` precedent exactly: origin is required, and this
 * relay has no participant-shaped origin of its own, so a sentinel is passed to
 * exclude NOTHING. The real exclusion travels in `authoredByConnectionId` — which
 * is precisely why that field had to exist (#2401) rather than being folded into
 * origin: the holder must be excluded, and the sentinel must not be.
 */
export const FULFILLMENT_DISPATCH_RELAY_ORIGIN = 'openlinker:fulfillment';

@Injectable()
export class FulfillmentDispatchRelayService implements IFulfillmentDispatchRelayService {
  private readonly logger = new Logger(FulfillmentDispatchRelayService.name);

  constructor(
    @Inject(FULFILLMENT_RELAY_GATE_SERVICE_TOKEN)
    private readonly gate: IFulfillmentRelayGateService,
    @Inject(ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN)
    private readonly relay: IOrderLifecycleRelayService
  ) {}

  async relayDispatch(intent: FulfillmentDispatchIntent): Promise<FulfillmentDispatchRelayOutcome> {
    const claim = await this.gate.claimDispatch(intent.workId);
    if (claim.status === 'already-relayed') {
      return { status: 'already-relayed' };
    }
    if (claim.status === 'unknown-work') {
      this.logger.warn(
        `Dispatch relay: no fulfillment work ${intent.workId} — nothing relayed. ` +
          `An intent naming a work row that does not exist is a defect, not a race.`
      );
      return { status: 'unknown-work', workId: intent.workId };
    }

    try {
      const result = await this.relay.relay({
        internalOrderId: claim.orderId,
        // Sentinel — excludes nothing. See the constant.
        originConnectionId: FULFILLMENT_DISPATCH_RELAY_ORIGIN,
        // The holder that dispatched. Without this, the relay tells the 3PL that
        // just shipped the parcel that the parcel shipped (DESIGN §5.5).
        authoredByConnectionId: claim.holderConnectionId ?? undefined,
        // NO WAYBILL, AND THE CLAIM MAKES THAT PERMANENT — a named limitation.
        // `FulfillmentShippedEvent` carries no tracking number (a 3PL reports
        // that the parcel left; the shipment is #2402's), so this relay tells a
        // participant only THAT the work dispatched. Burning `dispatchRelayedAt`
        // then means a waybill arriving later can never be relayed by this path,
        // and #1947's late-waybill backfill does NOT cover it: that one claims
        // `Shipment.waybillRelayedAt`, a different row, so a router-fulfilled
        // work has no shipment for it to key on. The operator-visible cost is
        // the one #1947 was opened about, one grain over — a marketplace still
        // asking the seller for a tracking number. Closing it belongs with the
        // reconcile sweep (filed separately), not here: relaying a waybill needs
        // a second, waybill-scoped claim, because re-driving THIS one would
        // re-send the dispatch fact the claim exists to send exactly once.
        event: { type: 'dispatched' },
      });

      const reason = this.describeTransientFailure(result.targets);
      if (reason !== null) {
        await this.gate.releaseDispatch(intent.workId);
        this.logger.warn(
          `Dispatch relay for work ${intent.workId} failed transiently (${reason}); ` +
            `relay claim released so a later progress event can re-drive it`
        );
        return { status: 'released', reason };
      }
      return { status: 'relayed' };
    } catch (error) {
      // `relay()` throws only from `getExternalIds` (see below), so this arm is
      // the identifier-mapping read failing — real, but not the common failure.
      await this.gate.releaseDispatch(intent.workId);
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Dispatch relay for work ${intent.workId} threw (${message}); relay claim released`
      );
      return { status: 'released', reason: 'relay threw' };
    }
  }

  /**
   * Whether the whole relay failed in a way a LATER event could recover from —
   * the predicate that decides whether the claim goes back.
   *
   * ## Why this is not a try/catch, and must not be "simplified" into one
   *
   * `OrderLifecycleRelayService.writeToTarget` CATCHES every adapter throw and
   * returns `{ outcome: 'rejected' }`; `relay()` itself throws only from
   * `getExternalIds`. So the realistic failure — a source waybill POST that 500s —
   * arrives here as a `rejected` TARGET, never as an exception. A predicate that
   * only looked at throws would read that as success, burn `dispatchRelayedAt`
   * forever and never relay the dispatch.
   *
   * ## Four arms, each load-bearing
   *
   *  - `rejected` — TRANSIENT. The participant was reached and refused or errored.
   *  - `unsupported` + `adapter-unresolved` — TRANSIENT (#1947): disabled
   *    connection, credentials unresolvable; may well succeed after a re-auth.
   *  - `unsupported` + `no-capability` — STRUCTURAL. NOT a failure: there is
   *    nothing to retry, and releasing would re-drive the relay forever against a
   *    participant that can never accept it.
   *  - `unsupported` + NO reason — STRUCTURAL, and this arm is deliberate rather
   *    than a fall-through. `OrderWritebackUnsupportedReason` is populated by the
   *    RELAY, and `writeToTarget` passes an adapter's own `OrderWritebackResult`
   *    through verbatim — so a bare `unsupported` is the common shape from an
   *    adapter's own `default:` arm (Allegro, Erli, WooCommerce and PrestaShop all
   *    emit one). Treated as structural because an adapter saying "I do not
   *    support this event" is a statement about its capability, and because the
   *    claim exists to stop a non-idempotent source POST being re-driven: when the
   *    reason is unknowable, NOT re-driving is the safe direction.
   *
   *    The cost is stated rather than hidden. Erli's `dispatched` writeback is
   *    gated by `OL_ERLI_DISPATCH_WRITEBACK_ENABLED` and returns a bare
   *    `unsupported` when off — which is config-transient, not structural, so
   *    flipping that flag on does NOT recover the works whose relay was already
   *    burned. Distinguishing it needs a third `unsupportedReason` member the
   *    adapter would have to declare; that is a change to #1947's union and its
   *    every consumer, not something to infer here.
   *
   * ## Why ZERO targets keeps the claim
   *
   * `[].every(...)` is vacuously true, so an unguarded predicate would call an
   * empty fan-out a total failure. With author-exclusion added that is a ROUTINE
   * path — a single-participant order whose only participant IS the holder — so
   * every replay would release and re-claim forever.
   *
   * ## Why EVERY rather than SOME
   *
   * A mixed result keeps the claim: one target applied, and releasing would
   * re-relay that succeeded participant on the next event. Recording the
   * asymmetry needs per-participant notify state, which is #861's open half.
   */
  private describeTransientFailure(targets: OrderLifecycleRelayTargetResult[]): string | null {
    if (targets.length === 0) {
      return null;
    }
    const allTransient = targets.every(
      (target) =>
        target.outcome === 'rejected' ||
        (target.outcome === 'unsupported' && target.unsupportedReason === 'adapter-unresolved')
    );
    if (!allTransient) {
      return null;
    }
    return targets
      .map(
        (target) =>
          `${target.connectionId}: ${target.outcome}${target.detail ? ` (${target.detail})` : ''}`
      )
      .join('; ');
  }
}
