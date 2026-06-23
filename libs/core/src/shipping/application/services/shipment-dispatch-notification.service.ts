/**
 * Shipment Dispatch Notification Service
 *
 * The branch-agnostic operator-dispatch orchestration (#837, spec step 5).
 * Given a dispatched OL-managed `Shipment`, it propagates "shipped + tracking"
 * to **every** other participant of the order — the source marketplace *and* the
 * destination shop(s) — through the single, role-agnostic `OrderStatusWriteback`
 * lifecycle relay (#1168 / ADR-027: "one writer per participant"). The branch is
 * irrelevant by construction — an InPost (own-contract) shipment carries a
 * synchronous `trackingNumber` so the source gets a waybill; an Allegro-Delivery
 * (source-brokered) shipment has none yet, so the source is merely marked sent
 * (it already holds the waybill it issued).
 *
 * **Origin of an operator dispatch (#1168).** The relay excludes its
 * `originConnectionId` from the targets; an OL-managed shipment has no
 * source-feed origin (the operator is the origin). We pass the **carrier**
 * connection (`shipment.connectionId`) as origin: in practice a carrier is a
 * `ShippingProviderManager`, never an order participant, so it excludes nothing
 * and the relay reaches the source + all destinations. (If a future connection
 * ever multiplexed a carrier role *and* an order-participant role, origin
 * exclusion would skip it — revisit with an explicit operator-origin sentinel.)
 *
 * Idempotency / partial-failure:
 * - **Status-gate**: only notifies a `generated` shipment, so the relay's
 *   source waybill-attach (`POST …/shipments`, dedup `needs-sandbox-probe`) runs
 *   at most once per shipment.
 * - **`dispatched` set on source-`applied` OR source-`absent`** (no source / no
 *   writeback capability), so a non-marketplace-sourced shipment still advances;
 *   a source `rejected` leaves `generated` (retriable). Destinations stay
 *   best-effort — a destination failure does not block the advance.
 * - Relay writes are idempotent at the adapter level (Allegro mark-sent treats a
 *   409 as success; PrestaShop skips an already-applied state), so leaving
 *   `generated` and re-driving on retry is safe.
 * - The gate is not atomic — the live call-site (#769/#771) must serialise per
 *   order (same caveat as `ShipmentDispatchService`).
 *
 * @module libs/core/src/shipping/application/services
 * @implements {IShipmentDispatchNotificationService}
 * @see {@link IOrderLifecycleRelayService} for the cross-system writeback path
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import {
  IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
} from '@openlinker/core/integrations';
import {
  type DispatchCarrierHint,
  type IOrderLifecycleRelayService,
  type IOrderRecordService,
  type OrderLifecycleRelayResult,
  type OrderRecord,
  ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN,
  ORDER_RECORD_SERVICE_TOKEN,
} from '@openlinker/core/orders';

import type { IShipmentDispatchNotificationService } from '../interfaces/shipment-dispatch-notification.service.interface';
import type {
  DispatchNotificationDestinationOutcome,
  DispatchNotificationSourceOutcome,
  ShipmentDispatchNotificationInput,
  ShipmentDispatchNotificationResult,
} from '../types/shipment-dispatch-notification.types';
import { ShipmentRepositoryPort } from '../../domain/ports/shipment-repository.port';
import { SHIPMENT_STATUS } from '../../domain/types/shipment-status.types';
import { SHIPMENT_REPOSITORY_TOKEN } from '../../shipping.tokens';

@Injectable()
export class ShipmentDispatchNotificationService
  implements IShipmentDispatchNotificationService
{
  private readonly logger = new Logger(ShipmentDispatchNotificationService.name);

  constructor(
    @Inject(SHIPMENT_REPOSITORY_TOKEN)
    private readonly shipments: ShipmentRepositoryPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecords: IOrderRecordService,
    // #1168: cross-system "shipped" propagation goes through the single
    // role-agnostic relay (subsumes the former source `notifyDispatched` +
    // destination `updateFulfillment`). Identifier mapping is the relay's job now.
    @Inject(ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN)
    private readonly orderLifecycleRelay: IOrderLifecycleRelayService,
  ) {}

  async notifyDispatched(
    input: ShipmentDispatchNotificationInput,
  ): Promise<ShipmentDispatchNotificationResult> {
    const shipment = await this.shipments.findById(input.shipmentId);
    if (!shipment) {
      return { shipmentId: input.shipmentId, outcome: 'shipment-not-found', source: 'absent', destinations: [] };
    }
    // Status-gate: at-most-once notify (and at-most-once source waybill-attach).
    if (shipment.status !== SHIPMENT_STATUS.Generated) {
      return { shipmentId: shipment.id, outcome: 'skipped-not-generated', source: 'absent', destinations: [] };
    }

    const record = await this.orderRecords.getOrderRecord(shipment.orderId);
    const carrier = await this.resolveCarrierHint(shipment.connectionId);

    // Relay "shipped + tracking" to every participant in one call. Origin =
    // the carrier connection, which is never an order participant, so the relay
    // reaches the source marketplace AND all destination shops.
    const relayOutcome = await this.relayDispatched(shipment.orderId, shipment.connectionId, {
      trackingNumber: shipment.trackingNumber ?? undefined,
      carrier,
    });

    // Re-label the relay's role-agnostic per-target outcomes back into the
    // service's {source, destinations} contract, by connection id. A catastrophic
    // relay failure (e.g. identifier resolution) is a source `failed` — NOT
    // `absent` — so the shipment stays `generated` and is retriable rather than
    // silently advancing past the at-most-once gate without notifying anyone.
    const source = relayOutcome.threw
      ? 'failed'
      : this.resolveSourceOutcome(relayOutcome.result, record);
    const destinations = this.resolveDestinationOutcomes(relayOutcome.result, record);

    // Advance to dispatched when the source was applied or there was nothing to
    // notify (no marketplace source). A source `failed`/`rejected` leaves
    // `generated` → retriable. Destinations stay best-effort and never block it.
    if (source === 'ok' || source === 'absent') {
      await this.shipments.update(shipment.id, {
        status: SHIPMENT_STATUS.Dispatched,
        dispatchedAt: new Date(),
      });
    }

    return { shipmentId: shipment.id, outcome: 'notified', source, destinations };
  }

  /** Carrier hint = the shipping processor connection's platformType (#837 Q5). */
  private async resolveCarrierHint(connectionId: string): Promise<DispatchCarrierHint | undefined> {
    try {
      const { metadata } = await this.integrations.getAdapter(connectionId);
      return { platformType: metadata.platformType };
    } catch (error) {
      // Degraded but non-fatal: with no hint, a source adapter attaching a
      // waybill falls back to its catch-all carrier (Allegro → OTHER + a generic
      // name). Log so that silent downgrade is traceable rather than invisible.
      this.logger.debug(
        `Carrier-hint resolution failed for connection ${connectionId}; a waybill (if any) will use the source adapter's catch-all carrier: ${this.message(error)}`,
      );
      return undefined;
    }
  }

  /**
   * Drive the lifecycle relay for the `dispatched` event. The relay never throws
   * on a single participant's failure (it reports per-target outcomes), but a
   * catastrophic failure (e.g. identifier resolution) can throw — caught here and
   * flagged via `threw` so the caller treats it as a source failure (no advance)
   * rather than a legitimate "no source participant" (advance).
   */
  private async relayDispatched(
    internalOrderId: string,
    originConnectionId: string,
    payload: { trackingNumber?: string; carrier?: DispatchCarrierHint },
  ): Promise<{ result: OrderLifecycleRelayResult; threw: boolean }> {
    try {
      const result = await this.orderLifecycleRelay.relay({
        internalOrderId,
        originConnectionId,
        event: { type: 'dispatched', trackingNumber: payload.trackingNumber, carrier: payload.carrier },
      });
      return { result, threw: false };
    } catch (error) {
      this.logger.warn(
        `Dispatch relay failed for order ${internalOrderId} (origin ${originConnectionId}): ${this.message(error)}`,
      );
      return { result: { targets: [] }, threw: true };
    }
  }

  /**
   * The source target is the one whose connection matches the order's
   * `sourceConnectionId`. `applied`→`ok`, `rejected`→`failed`; a missing target
   * or `unsupported` (no writeback capability) → `absent`. A null record (no
   * order record) yields `absent` (mirrors the legacy `!sourceConnectionId` path).
   */
  private resolveSourceOutcome(
    relayResult: OrderLifecycleRelayResult,
    record: OrderRecord | null,
  ): DispatchNotificationSourceOutcome {
    const sourceConnectionId = record?.sourceConnectionId;
    if (!sourceConnectionId) {
      return 'absent';
    }
    const target = relayResult.targets.find((t) => t.connectionId === sourceConnectionId);
    if (!target) {
      return 'absent';
    }
    switch (target.outcome) {
      case 'applied':
        return 'ok';
      case 'rejected':
        return 'failed';
      default:
        return 'absent';
    }
  }

  /**
   * Every relayed target that is not the source is a destination (best-effort).
   * Targets come from the relay's identifier-mapping resolution (#1168) — the
   * canonical participant store written at order provisioning — NOT from
   * `record.syncStatus`. In practice the two align; a destination present only in
   * `syncStatus` without an Order identifier mapping is not reached (and would be
   * the anomaly to fix at the mapping layer, not here).
   */
  private resolveDestinationOutcomes(
    relayResult: OrderLifecycleRelayResult,
    record: OrderRecord | null,
  ): DispatchNotificationDestinationOutcome[] {
    const sourceConnectionId = record?.sourceConnectionId;
    return relayResult.targets
      .filter((t) => t.connectionId !== sourceConnectionId)
      .map((t) => ({
        connectionId: t.connectionId,
        status:
          t.outcome === 'applied' ? 'ok' : t.outcome === 'rejected' ? 'failed' : 'unsupported',
      }));
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
