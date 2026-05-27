/**
 * Shipment Dispatch Notification Service
 *
 * The branch-agnostic "mark sent on source + OMP" orchestration (#837, spec
 * step 5). Given a dispatched `Shipment`, it resolves the order's source and
 * destination connection(s) from its `OrderRecord` and drives two generic
 * capabilities: `OrderDispatchNotifier` on the source (mark sent + attach the
 * waybill when one exists) and `OrderFulfillmentUpdater` on each destination
 * (status + tracking). The branch is irrelevant by construction — an InPost
 * (own-contract) shipment carries a synchronous `trackingNumber` so the source
 * gets a waybill; an Allegro-Delivery (source-brokered) shipment has none yet,
 * so the source is merely marked sent (it already holds the waybill it issued).
 *
 * Idempotency / partial-failure (see implementation-plan §3.4):
 * - **Status-gate**: only notifies a `generated` shipment, so the source
 *   waybill-attach (`POST …/shipments`, dedup `needs-sandbox-probe`) runs at
 *   most once per shipment.
 * - **`dispatched` set on A-success OR A-absent** (no source / no capability),
 *   so a non-marketplace-sourced shipment still advances; an A-failure leaves
 *   `generated` (retriable).
 * - **B is best-effort** (per-destination, isolated, logged) — once A succeeds
 *   the status-gate blocks re-notify, so a B failure is not auto-retried in v1
 *   (a per-target notify-state model is the follow-up; branch-3 late tracking
 *   propagation is #838's).
 * - The gate is not atomic — the live call-site (#769/#771) must serialise per
 *   order (same caveat as `ShipmentDispatchService`).
 *
 * Unwired in #837 (no trigger), exactly as #835 shipped `dispatch()`.
 *
 * @module libs/core/src/shipping/application/services
 * @implements {IShipmentDispatchNotificationService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import {
  IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
} from '@openlinker/core/integrations';
import {
  CORE_ENTITY_TYPE,
  IIdentifierMappingService,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
} from '@openlinker/core/identifier-mapping';
import {
  type DispatchCarrierHint,
  type IOrderRecordService,
  type OrderProcessorManagerPort,
  type OrderRecord,
  type OrderSourcePort,
  isOrderDispatchNotifier,
  isOrderFulfillmentUpdater,
  ORDER_RECORD_SERVICE_TOKEN,
} from '@openlinker/core/orders';

import type { IShipmentDispatchNotificationService } from '../interfaces/shipment-dispatch-notification.service.interface';
import type {
  ShipmentDispatchNotificationInput,
  ShipmentDispatchNotificationResult,
} from '../types/shipment-dispatch-notification.types';
import type { Shipment } from '../../domain/entities/shipment.entity';
import { ShipmentRepositoryPort } from '../../domain/ports/shipment-repository.port';
import { SHIPMENT_STATUS } from '../../domain/types/shipment-status.types';
import { SHIPMENT_REPOSITORY_TOKEN } from '../../shipping.tokens';

const ORDER_SOURCE_CAPABILITY = 'OrderSource';
const ORDER_PROCESSOR_MANAGER_CAPABILITY = 'OrderProcessorManager';

type SourceOutcome = 'ok' | 'failed' | 'absent';
type DestinationOutcome = { connectionId: string; status: 'ok' | 'failed' | 'unsupported' };

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
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService,
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

    const source = await this.notifySource(shipment, record, carrier);
    const destinations = await this.updateDestinations(shipment, record);

    // Advance to dispatched when the source was notified or there was nothing to
    // notify (no marketplace source). An A-failure leaves `generated` → retriable.
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

  /** A — mark sent on the order source (+ attach waybill when present). */
  private async notifySource(
    shipment: Shipment,
    record: OrderRecord | null,
    carrier: DispatchCarrierHint | undefined,
  ): Promise<SourceOutcome> {
    if (!record?.sourceConnectionId) {
      return 'absent';
    }
    const externalIds = await this.identifierMapping.getExternalIds(
      CORE_ENTITY_TYPE.Order,
      shipment.orderId,
    );
    const sourceExternalId = externalIds.find(
      (e) => e.connectionId === record.sourceConnectionId,
    )?.externalId;
    if (!sourceExternalId) {
      return 'absent';
    }

    let adapter: OrderSourcePort;
    try {
      adapter = await this.integrations.getCapabilityAdapter<OrderSourcePort>(
        record.sourceConnectionId,
        ORDER_SOURCE_CAPABILITY,
      );
    } catch {
      return 'absent';
    }
    if (!isOrderDispatchNotifier(adapter)) {
      return 'absent';
    }

    try {
      await adapter.notifyDispatched({
        externalOrderId: sourceExternalId,
        trackingNumber: shipment.trackingNumber ?? undefined,
        carrier,
      });
      return 'ok';
    } catch (error) {
      this.logger.warn(
        `Source dispatch-notify failed for shipment ${shipment.id} (order ${shipment.orderId}): ${this.message(error)}`,
      );
      return 'failed';
    }
  }

  /** B — push status + tracking to each synced destination OMP (best-effort). */
  private async updateDestinations(
    shipment: Shipment,
    record: OrderRecord | null,
  ): Promise<DestinationOutcome[]> {
    // Gate on external-id presence, NOT on sync status: if a destination carries
    // an externalOrderId the order exists there, so a shipped+tracking update is
    // valid even if that destination's last sync attempt failed.
    const withExternalId = (record?.syncStatus ?? []).filter(
      (s): s is typeof s & { externalOrderId: string } => Boolean(s.externalOrderId),
    );

    return Promise.all(
      withExternalId.map(async (entry): Promise<DestinationOutcome> => {
        try {
          const adapter = await this.integrations.getCapabilityAdapter<OrderProcessorManagerPort>(
            entry.destinationConnectionId,
            ORDER_PROCESSOR_MANAGER_CAPABILITY,
          );
          if (!isOrderFulfillmentUpdater(adapter)) {
            return { connectionId: entry.destinationConnectionId, status: 'unsupported' };
          }
          await adapter.updateFulfillment({
            externalOrderId: entry.externalOrderId,
            status: 'shipped',
            trackingNumber: shipment.trackingNumber ?? undefined,
          });
          return { connectionId: entry.destinationConnectionId, status: 'ok' };
        } catch (error) {
          this.logger.warn(
            `Destination fulfillment-update failed for shipment ${shipment.id} dest ${entry.destinationConnectionId}: ${this.message(error)}`,
          );
          return { connectionId: entry.destinationConnectionId, status: 'failed' };
        }
      }),
    );
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
