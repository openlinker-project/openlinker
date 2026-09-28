/**
 * Fulfilment Parcel Closure Notifier (#3525)
 *
 * Closes the loop the bug names: neither the pack bench's automatic close nor
 * the desktop worklist's manual `close` action ever called
 * `IFulfillmentProgressService.record()`, so no `shipped` progress claim was
 * ever created for OpenLinker-executed work, no dispatch-relay intent was
 * ever composed, and the order's channel learned the parcel shipped only when
 * an operator separately remembered `POST /shipments/:id/notify-dispatched`.
 *
 * ## Why `'shipped'`, not `'closed'`
 *
 * `FulfillmentProgressEventKindValues` carries both, and both are truthful
 * descriptions of a closed parcel — but `FulfillmentProgressService.apply()`'s
 * `'closed'` arm transitions no counters and reports `intents: []`, while its
 * `'shipped'` arm is the ONLY one that returns `{kind: 'dispatch', workId}`.
 * The epic's own product decision — "closing a parcel is what tells the
 * channel it shipped" — is exactly that mapping, so this notifier always
 * records `'shipped'`, never `'closed'`, whichever write closed the parcel.
 *
 * ## Two relay paths for ONE intent, and why both exist (review correction)
 *
 * The work-grain `IFulfillmentDispatchRelayService.relayDispatch` — the only
 * path this file had at first — drives `FulfillmentShippedEvent`, which
 * carries NO tracking number and NO carrier (the port's own contract; see
 * `fulfillment-execution.types.ts`). For OL-executed work with a LINKED
 * outbound `Shipment` still `generated` (the ordinary `ol_managed_carrier`
 * case: an operator bought a label, #2402 stamped `fulfillmentWorkId`), that
 * path would mark the channel "shipped" with no waybill, leave the shipment
 * itself stuck at `generated` forever (so #2347's reservation-consume never
 * fires), and require an operator to still click `notify-dispatched` — which
 * then relays "dispatched" a SECOND time. That defeats the "no separate
 * manual click" acceptance criterion for the most common case.
 *
 * So a closed parcel with exactly one linked `generated` shipment goes
 * through the SHIPMENT-grain path instead —
 * `IShipmentDispatchNotificationService.notifyDispatched`, which carries the
 * tracking number and carrier, advances the shipment to `dispatched` (feeding
 * #2347's reservation consumption), and already owns its own at-most-once
 * status gate (`shipment.status !== 'generated'` refuses a repeat). The
 * work-grain relay's OWN at-most-once slot (`dispatchRelayedAt`) is then
 * claimed WITHOUT relaying — `IFulfillmentRelayGateService.markRelayedExternally`
 * — so the #2728 reconcile sweep, which re-drives only work whose slot is
 * still open, never re-fires the tracking-less work-grain relay behind a
 * shipment the channel was already correctly told about.
 *
 * With NO linked shipment (0, or more than one — a split order, ambiguous)
 * the work-grain relay is unchanged: there is nothing more specific to defer
 * to, so the pre-existing, tracking-less-but-correct behaviour stands.
 *
 * ## No new shipment-CREATION path
 *
 * Neither relay path creates a `Shipment` row. The shipment-grain path only
 * ADVANCES a row `ShipmentDispatchService` already created —
 * `ShipmentDispatchService` and the branch-1 status projection remain the
 * only two places a `Shipment` row is minted (#2402).
 *
 * ## Every failure mode is absorbed here, once
 *
 * A `duplicate` / `unknown-work` / `precondition-failed` progress outcome, a
 * `released` / `unknown-work` work-grain relay outcome, and a failed
 * shipment-grain notify are all ORDINARY, not errors — see each interface's
 * own docblock. A shipment-grain failure leaves the shipment `generated`
 * (the service's own existing retriable behaviour) and deliberately does
 * NOT fall back to the tracking-less work-grain relay in the same call: the
 * work-grain slot is left UNCLAIMED, so the #2728 sweep (or a future
 * operator `notify-dispatched` click) remains free to retry through either
 * path later — exactly the choice a caller already had before this notifier
 * existed. Only a genuine throw (infrastructure fault) is caught and
 * logged; nothing here ever propagates, because the parcel close this call
 * reports on has already committed.
 *
 * @module apps/api/src/fulfillment/application/services
 * @implements {IFulfillmentParcelClosureNotifier}
 */
import { Inject, Injectable } from '@nestjs/common';

import {
  buildFulfillmentParcelClosureIdempotencyKey,
  FULFILLMENT_PROGRESS_SERVICE_TOKEN,
  FULFILLMENT_RELAY_GATE_SERVICE_TOKEN,
  type IFulfillmentProgressService,
  type IFulfillmentRelayGateService,
} from '@openlinker/core/fulfillment';
import {
  FULFILLMENT_DISPATCH_RELAY_SERVICE_TOKEN,
  type IFulfillmentDispatchRelayService,
} from '@openlinker/core/orders';
import {
  SHIPMENT_DISPATCH_NOTIFICATION_SERVICE_TOKEN,
  SHIPMENT_QUERY_SERVICE_TOKEN,
  SHIPMENT_STATUS,
  type IShipmentDispatchNotificationService,
  type IShipmentQueryService,
  type Shipment,
} from '@openlinker/core/shipping';
import { Logger } from '@openlinker/shared/logging';

import type {
  IFulfillmentParcelClosureNotifier,
  NotifyFulfillmentParcelClosedInput,
} from '../interfaces/fulfillment-parcel-closure-notifier.service.interface';

@Injectable()
export class FulfillmentParcelClosureNotifierService implements IFulfillmentParcelClosureNotifier {
  private readonly logger = new Logger(FulfillmentParcelClosureNotifierService.name);

  constructor(
    @Inject(FULFILLMENT_PROGRESS_SERVICE_TOKEN)
    private readonly progress: IFulfillmentProgressService,
    @Inject(FULFILLMENT_DISPATCH_RELAY_SERVICE_TOKEN)
    private readonly relay: IFulfillmentDispatchRelayService,
    @Inject(FULFILLMENT_RELAY_GATE_SERVICE_TOKEN)
    private readonly relayGate: IFulfillmentRelayGateService,
    @Inject(SHIPMENT_QUERY_SERVICE_TOKEN)
    private readonly shipments: IShipmentQueryService,
    @Inject(SHIPMENT_DISPATCH_NOTIFICATION_SERVICE_TOKEN)
    private readonly shipmentDispatchNotification: IShipmentDispatchNotificationService
  ) {}

  async notifyParcelClosed(input: NotifyFulfillmentParcelClosedInput): Promise<void> {
    try {
      const outcome = await this.progress.record({
        kind: 'shipped',
        workId: input.workId,
        connectionId: input.connectionId,
        idempotencyKey: buildFulfillmentParcelClosureIdempotencyKey(input.workId, input.closedAt),
        occurredAt: input.closedAt,
      });

      if (outcome.status === 'duplicate') {
        // An earlier close (bench + worklist can both legally close the same
        // work, or a retried request replayed the identical instant) already
        // reported this fact — the claim table's whole job.
        return;
      }
      if (outcome.status === 'unknown-work') {
        // Unreachable in practice: both callers just loaded this exact work
        // row. Logged rather than ignored, because it would mean a delete
        // raced the close.
        this.logger.warn(
          `Progress record named unknown work ${outcome.workId} immediately after it closed`
        );
        return;
      }
      if (outcome.status === 'precondition-failed') {
        // The `'shipped'` arm writes no counters and transitions no status
        // (see this file's header), so this arm is unreachable for a
        // `'shipped'` event today — recorded defensively rather than assumed.
        this.logger.warn(
          `Progress record for closed work ${input.workId} reported precondition-failed: ${outcome.reason}`
        );
        return;
      }

      for (const intent of outcome.intents) {
        if (intent.kind !== 'dispatch') continue;
        await this.relayForWork(intent.workId);
      }
    } catch (error) {
      this.logger.error(
        `Could not notify the order's channel that fulfilment work ${input.workId} shipped: ` +
          `${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined
      );
    }
  }

  /**
   * Route the `dispatch` intent through the shipment-grain path when exactly
   * one linked `generated` shipment exists, else the pre-existing work-grain
   * relay. See this file's header for why the two are not interchangeable.
   */
  private async relayForWork(workId: string): Promise<void> {
    let linked: Shipment | null = null;
    try {
      linked = await this.findSingleLinkedGeneratedShipment(workId);
    } catch (error) {
      // Best-effort: a failed lookup falls back to the pre-existing
      // work-grain relay rather than notifying nobody. `relayDispatch` below
      // is always safe to call — its own claim makes a subsequent shipment-
      // grain success (once the lookup recovers) a harmless race.
      this.logger.warn(
        `Could not resolve a linked shipment for work ${workId}; falling back to the ` +
          `work-grain relay: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (linked !== null) {
      const handledByShipment = await this.relayViaShipment(workId, linked.id);
      if (handledByShipment) return;
      // The shipment-grain path failed. Deliberately NOT falling back to the
      // work-grain relay in this same call — see this file's header. The
      // shipment stays `generated` (retriable) and the work-grain slot stays
      // unclaimed, so a later event (#2728's sweep, or an operator's manual
      // `notify-dispatched`) remains free to retry through either path.
      return;
    }

    await this.relayDispatch(workId);
  }

  /**
   * The work's one linked OUTBOUND shipment still `generated`, or `null` when
   * there is none or more than one (a split order — genuinely ambiguous,
   * #2402's grain is per-work but a `Shipment` carries no line composition,
   * so there is no sub-work id to disambiguate by).
   */
  private async findSingleLinkedGeneratedShipment(workId: string): Promise<Shipment | null> {
    const byWork = await this.shipments.findByFulfillmentWorkIds([workId], 'outbound');
    const generated = (byWork.get(workId) ?? []).filter(
      (shipment) => shipment.status === SHIPMENT_STATUS.Generated
    );
    if (generated.length === 0) return null;
    if (generated.length > 1) {
      this.logger.warn(
        `Work ${workId} carries ${String(generated.length)} generated shipments; ` +
          'falling back to the work-grain relay rather than guessing which one shipped'
      );
      return null;
    }
    return generated[0];
  }

  /**
   * Drive the shipment-grain notify, and claim the work-grain slot on success
   * so the tracking-less relay is never sent behind it.
   *
   * @returns whether the channel was told through this path — `false` on any
   * failure, including one this method catches itself.
   */
  private async relayViaShipment(workId: string, shipmentId: string): Promise<boolean> {
    try {
      const result = await this.shipmentDispatchNotification.notifyDispatched({ shipmentId });
      const told = result.outcome === 'notified' && result.source !== 'failed';
      if (!told) {
        this.logger.warn(
          `Shipment-grain dispatch notification for work ${workId} (shipment ${shipmentId}) ` +
            `did not land (outcome=${result.outcome}, source=${result.source}); the shipment ` +
            'stays generated and retriable'
        );
        return false;
      }

      const claimed = await this.relayGate.markRelayedExternally(workId);
      if (!claimed) {
        // A peer (the work-grain relay, or a concurrent close) already holds
        // the slot. Harmless — the channel was told either way, by whichever
        // path won.
        this.logger.debug(
          `Work ${workId}'s dispatch-relay slot was already claimed when the shipment-grain ` +
            'notify succeeded; nothing more to do'
        );
      }
      return true;
    } catch (error) {
      this.logger.warn(
        `Shipment-grain dispatch notification threw for work ${workId} (shipment ${shipmentId}): ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  private async relayDispatch(workId: string): Promise<void> {
    const relayed = await this.relay.relayDispatch({ kind: 'dispatch', workId });

    if (relayed.status === 'released') {
      // A transient failure. `dispatchRelayedAt` is back to NULL, so the
      // #2728 reconcile sweep (`fulfillment.work.relaySweep`) picks it up on
      // its next tick — see that handler for why re-driving it synchronously
      // here would be the wrong shape.
      this.logger.warn(
        `Dispatch relay for work ${workId} did not land (${relayed.reason}); ` +
          'the fulfilment.work.relaySweep reconcile pass will retry it'
      );
      return;
    }
    if (relayed.status === 'unknown-work') {
      this.logger.warn(
        `Dispatch relay named unknown work ${relayed.workId} immediately after it closed`
      );
    }
    // 'relayed' and 'already-relayed' are both the honest steady state —
    // nothing further to do.
  }
}
