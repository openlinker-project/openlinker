/**
 * Fulfillment Work Dispatch Router Service (#3506, G02-4; extracted from #3525)
 *
 * Routes one fulfilment work's `dispatch` intent to the order's channel —
 * "shipment-first". Moved verbatim out of `FulfillmentParcelClosureNotifierService`
 * so the `fulfillment.work.relaySweep` reconcile pass makes the SAME choice the
 * first attempt made.
 *
 * ## Two relay paths for ONE intent, and why both exist
 *
 * The work-grain `IFulfillmentDispatchRelayService.relayDispatch` drives
 * `FulfillmentShippedEvent`, which carries NO tracking number and NO carrier
 * (the port's own contract). For OL-executed work with a LINKED outbound
 * `Shipment` still `generated` (the ordinary `ol_managed_carrier` case: an
 * operator bought a label, #2402 stamped `fulfillmentWorkId`), that path marks
 * the channel "shipped" with no waybill and leaves the shipment at `generated`
 * forever — so #2347's reservation-consume never fires and nothing ever relays
 * the waybill (`ShipmentStatusSyncService` only BACKFILLS the number while a
 * shipment is `generated`; the `generated → dispatched` transition belongs to
 * `notifyDispatched`).
 *
 * So a work with exactly one linked `generated` shipment goes through the
 * SHIPMENT-grain path — `IShipmentDispatchNotificationService.notifyDispatched`,
 * which carries the tracking number and carrier, advances the shipment to
 * `dispatched`, and owns its own at-most-once status gate. The work-grain
 * slot (`dispatchRelayedAt`) is then claimed WITHOUT relaying via
 * `IFulfillmentRelayGateService.markRelayedExternally`, so the reconcile sweep
 * never re-fires the tracking-less relay behind a channel already told.
 *
 * With NO linked generated shipment (0, or more than one — a split order, and
 * a `Shipment` carries no line composition to disambiguate by) the work-grain
 * relay is used: there is nothing more specific to defer to.
 *
 * ## No fallback after a shipment-grain failure
 *
 * A failed shipment-grain notify leaves the shipment `generated` (that
 * service's own retriable behaviour) and the work-grain slot UNCLAIMED, and
 * does NOT fall back to the work-grain relay in the same call. Falling back
 * is precisely G02-4: the channel learns "sent", the slot is burnt, the work
 * leaves the frontier, and the waybill is never sent. Leaving the slot open
 * keeps the work on the reconcile frontier, so the next sweep tick retries the
 * SHIPMENT-grain path — and a work that can never be notified that way is
 * escalated by the sweep's stuck bound rather than silently degraded.
 *
 * ## No new shipment-creation path
 *
 * Neither path creates a `Shipment` row; the shipment-grain path only ADVANCES
 * a row `ShipmentDispatchService` already created (#2402).
 *
 * @module libs/core/src/shipping/application/services
 * @implements {IFulfillmentWorkDispatchRouterService}
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  FULFILLMENT_RELAY_GATE_SERVICE_TOKEN,
  type IFulfillmentRelayGateService,
} from '@openlinker/core/fulfillment';
import {
  FULFILLMENT_DISPATCH_RELAY_SERVICE_TOKEN,
  type IFulfillmentDispatchRelayService,
} from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';

import type { IFulfillmentWorkDispatchRouterService } from '../interfaces/fulfillment-work-dispatch-router.service.interface';
import { IShipmentDispatchNotificationService } from '../interfaces/shipment-dispatch-notification.service.interface';
import { IShipmentQueryService } from '../interfaces/shipment-query.service.interface';
import type { WorkDispatchRouteOutcome } from '../types/fulfillment-work-dispatch-router.types';
import type { Shipment } from '../../domain/entities/shipment.entity';
import { SHIPMENT_STATUS } from '../../domain/types/shipment-status.types';
import {
  SHIPMENT_DISPATCH_NOTIFICATION_SERVICE_TOKEN,
  SHIPMENT_QUERY_SERVICE_TOKEN,
} from '../../shipping.tokens';

@Injectable()
export class FulfillmentWorkDispatchRouterService implements IFulfillmentWorkDispatchRouterService {
  private readonly logger = new Logger(FulfillmentWorkDispatchRouterService.name);

  constructor(
    @Inject(FULFILLMENT_DISPATCH_RELAY_SERVICE_TOKEN)
    private readonly relay: IFulfillmentDispatchRelayService,
    @Inject(FULFILLMENT_RELAY_GATE_SERVICE_TOKEN)
    private readonly relayGate: IFulfillmentRelayGateService,
    @Inject(SHIPMENT_QUERY_SERVICE_TOKEN)
    private readonly shipments: IShipmentQueryService,
    @Inject(SHIPMENT_DISPATCH_NOTIFICATION_SERVICE_TOKEN)
    private readonly shipmentDispatchNotification: IShipmentDispatchNotificationService
  ) {}

  async routeDispatch(workId: string): Promise<WorkDispatchRouteOutcome> {
    let linked: Shipment | null = null;
    try {
      linked = await this.findSingleLinkedGeneratedShipment(workId);
    } catch (error) {
      // Best-effort: a failed lookup falls back to the work-grain relay rather
      // than notifying nobody. The relay's own claim makes a later
      // shipment-grain success (once the lookup recovers) a harmless race.
      this.logger.warn(
        `Could not resolve a linked shipment for work ${workId}; falling back to the ` +
          `work-grain relay: ${this.message(error)}`
      );
    }

    if (linked !== null) {
      return this.relayViaShipment(workId, linked.id);
    }

    return this.relay.relayDispatch({ kind: 'dispatch', workId });
  }

  /**
   * The work's one linked OUTBOUND shipment still `generated`, or `null` when
   * there is none or more than one.
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
   */
  private async relayViaShipment(
    workId: string,
    shipmentId: string
  ): Promise<WorkDispatchRouteOutcome> {
    let told: boolean;
    let reason = '';
    try {
      const result = await this.shipmentDispatchNotification.notifyDispatched({ shipmentId });
      told = result.outcome === 'notified' && result.source !== 'failed';
      reason = `outcome=${result.outcome}, source=${result.source}`;
    } catch (error) {
      told = false;
      reason = `threw: ${this.message(error)}`;
    }

    if (!told) {
      this.logger.warn(
        `Shipment-grain dispatch notification for work ${workId} (shipment ${shipmentId}) ` +
          `did not land (${reason}); the shipment stays generated and the work stays on the ` +
          'relay frontier'
      );
      return { status: 'shipment-failed', shipmentId, reason };
    }

    // The channel HAS been told by this point, so a failure to record that on
    // the work is reported as what it is — `via-shipment` — rather than as a
    // shipment failure. The cost of the unclaimed slot is one later
    // tracking-less work-grain relay of a fact the channel already holds,
    // which every shipped writeback adapter treats as a no-op.
    try {
      const claimed = await this.relayGate.markRelayedExternally(workId);
      if (!claimed) {
        // A peer (the work-grain relay, or a concurrent close) already holds
        // the slot. Harmless — the channel was told either way.
        this.logger.debug(
          `Work ${workId}'s dispatch-relay slot was already claimed when the shipment-grain ` +
            'notify succeeded; nothing more to do'
        );
      }
    } catch (error) {
      this.logger.warn(
        `Shipment-grain notify for work ${workId} (shipment ${shipmentId}) landed, but the ` +
          `work-grain slot could not be claimed: ${this.message(error)}`
      );
    }
    return { status: 'via-shipment', shipmentId };
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
