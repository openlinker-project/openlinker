/**
 * Shipment Status Sync Service
 *
 * Cursor-based poll over OL's own `Shipment`s for one shipping-provider
 * connection (#838). For each non-terminal shipment it (1) reads the carrier's
 * `TrackingSnapshot` via `ShippingProviderManagerPort.getTracking`, (2) builds
 * a patch reflecting carrier reality (status into terminal states +
 * trackingNumber backfill), and (3) propagates a newly-arrived tracking number
 * to the destination OMP via capability B (`OrderFulfillmentUpdater`) — same
 * resolution path `ShipmentDispatchNotificationService.updateDestinations`
 * uses, but without that service's `'generated'`-status gate (which exists for
 * #837's first-push semantics and isn't reusable here).
 *
 * Mirrors `OfferStatusSyncService` (#816): the service returns scan stats; the
 * caller (worker handler) advances the persisted `connection_cursors` offset.
 *
 * Two locally-correct v1 workarounds (both dissolve under #861, see the
 * implementation-plan §3.4):
 *
 * - **Push-first ordering** — if the OMP push throws for *any* destination,
 *   `trackingNumber` is dropped from the patch so the next poll sees the diff
 *   and retries. Without notify-state, `Shipment.trackingNumber` itself is the
 *   only thing distinguishing "already projected" from "not yet projected";
 *   updating it before a failed push would lose the backfill until manual
 *   intervention.
 * - **Dispatched-gate on the OMP push** — `updateFulfillment(status:'shipped')`
 *   fires only when `Shipment.status` is `dispatched`-or-richer, so #838 never
 *   marks a PS order shipped before #837's `notifyDispatched` has had its
 *   turn. For `generated` shipments we still backfill `Shipment.trackingNumber`
 *   so the next #837 invocation reads it and pushes once, correctly ordered.
 *
 * @module libs/core/src/shipping/application/services
 * @implements {IShipmentStatusSyncService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import {
  IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
} from '@openlinker/core/integrations';
import {
  type IOrderRecordService,
  type OrderProcessorManagerPort,
  isOrderFulfillmentUpdater,
  ORDER_RECORD_SERVICE_TOKEN,
} from '@openlinker/core/orders';

import type { IShipmentStatusSyncService } from '../interfaces/shipment-status-sync.service.interface';
import type {
  ShipmentStatusSyncOptions,
  ShipmentStatusSyncResult,
} from '../types/shipment-status-sync.types';
import type { Shipment } from '../../domain/entities/shipment.entity';
import { ShipmentRepositoryPort } from '../../domain/ports/shipment-repository.port';
import type { ShippingProviderManagerPort } from '../../domain/ports/shipping-provider-manager.port';
import type { TrackingSnapshot } from '../../domain/types/tracking-snapshot.types';
import type {
  ShipmentStatus} from '../../domain/types/shipment-status.types';
import {
  SHIPMENT_STATUS,
  TerminalShipmentStatusValues,
} from '../../domain/types/shipment-status.types';
import type { UpdateShipmentInput } from '../../domain/types/shipment.types';
import { SHIPMENT_REPOSITORY_TOKEN } from '../../shipping.tokens';

const SHIPPING_PROVIDER_MANAGER_CAPABILITY = 'ShippingProviderManager';
const ORDER_PROCESSOR_MANAGER_CAPABILITY = 'OrderProcessorManager';

/**
 * Statuses the scan visits — non-terminal, in the order the lifecycle
 * progresses. Excludes `draft` (no provider id yet) and the three terminals
 * (no further changes expected).
 */
const SCAN_STATUSES: readonly ShipmentStatus[] = [
  SHIPMENT_STATUS.Generated,
  SHIPMENT_STATUS.Dispatched,
  SHIPMENT_STATUS.InTransit,
];

/**
 * Statuses from which the OMP push is allowed (#838 workaround #2). At
 * `generated` we still backfill `Shipment.trackingNumber` but defer the OMP
 * push to #837's `notifyDispatched` so the source + dest are notified once,
 * in order.
 */
const PUSH_GATE_OPEN_FROM: readonly ShipmentStatus[] = [
  SHIPMENT_STATUS.Dispatched,
  SHIPMENT_STATUS.InTransit,
];

@Injectable()
export class ShipmentStatusSyncService implements IShipmentStatusSyncService {
  private readonly logger = new Logger(ShipmentStatusSyncService.name);

  constructor(
    @Inject(SHIPMENT_REPOSITORY_TOKEN)
    private readonly shipments: ShipmentRepositoryPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecords: IOrderRecordService,
  ) {}

  async sync(
    connectionId: string,
    options: ShipmentStatusSyncOptions,
  ): Promise<ShipmentStatusSyncResult> {
    const offset = options.offset ?? 0;
    const { limit } = options;

    const page = await this.shipments.findMany(
      { connectionId, statuses: SCAN_STATUSES },
      { offset, limit },
    );

    let updated = 0;
    let propagated = 0;
    let failed = 0;

    let carrierAdapter: (ShippingProviderManagerPort & object) | null = null;

    for (const shipment of page.items) {
      if (!shipment.providerShipmentId) {
        // Edge case: a generated shipment without a provider id is a dispatch
        // hole upstream; nothing to poll. Don't touch.
        continue;
      }
      try {
        if (!carrierAdapter) {
          carrierAdapter = await this.integrations.getCapabilityAdapter<ShippingProviderManagerPort>(
            connectionId,
            SHIPPING_PROVIDER_MANAGER_CAPABILITY,
          );
        }
        const snapshot = await carrierAdapter.getTracking({
          providerShipmentId: shipment.providerShipmentId,
        });

        const { didPush, patch } = await this.buildPatchAndMaybePush(shipment, snapshot);

        if (Object.keys(patch).length > 0) {
          await this.shipments.update(shipment.id, patch);
          updated += 1;
        }
        if (didPush) {
          propagated += 1;
        }
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `Shipment-status sync failed for shipment ${shipment.id} (connection ${connectionId}): ${this.message(error)}`,
        );
      }
    }

    const consumed = offset + page.items.length;
    const nextOffset = consumed >= page.total ? 0 : consumed;

    return {
      scanned: page.items.length,
      updated,
      propagated,
      failed,
      total: page.total,
      nextOffset,
    };
  }

  /**
   * Diff the snapshot against the shipment, attempt the OMP push under the
   * dispatched-gate (workaround #2), and return the patch. On push failure
   * (any destination), `trackingNumber` is excluded from the patch so the
   * next poll retries (workaround #1).
   */
  private async buildPatchAndMaybePush(
    shipment: Shipment,
    snapshot: TrackingSnapshot,
  ): Promise<{ didPush: boolean; patch: UpdateShipmentInput }> {
    const patch: UpdateShipmentInput = {};

    // 1. Status — advance only into TERMINAL states. Forward transitions out
    //    of `generated → dispatched` are #837's job (it pairs source + dest
    //    notify with the transition); #838 must not race that pairing.
    if (
      snapshot.status !== shipment.status &&
      TerminalShipmentStatusValues.includes(
        snapshot.status as (typeof TerminalShipmentStatusValues)[number],
      )
    ) {
      patch.status = snapshot.status;
      if (snapshot.status === SHIPMENT_STATUS.Delivered && snapshot.deliveredAt) {
        patch.deliveredAt = snapshot.deliveredAt;
      }
      if (snapshot.status === SHIPMENT_STATUS.Cancelled) {
        patch.cancelledAt = new Date();
      }
      if (snapshot.status === SHIPMENT_STATUS.Failed) {
        patch.failedAt = new Date();
      }
    }

    // 2. Tracking number — backfill on null → value transition. Carriers that
    //    deliver waybills asynchronously (Allegro Delivery #833) populate this
    //    on a later poll.
    const newTrackingNumber =
      shipment.trackingNumber === null && typeof snapshot.trackingNumber === 'string'
        ? snapshot.trackingNumber
        : null;

    if (newTrackingNumber === null) {
      return { didPush: false, patch };
    }

    // 3. OMP push under the dispatched-gate (v1 workaround #2 — removed when
    //    #861 lands). For `generated` shipments we still backfill the data
    //    field on `Shipment` so #837's `notifyDispatched` reads it; we just
    //    don't fire `updateFulfillment` ourselves.
    if (!PUSH_GATE_OPEN_FROM.includes(shipment.status)) {
      patch.trackingNumber = newTrackingNumber;
      return { didPush: false, patch };
    }

    const allDestPushOk = await this.pushTrackingToOmps(shipment, newTrackingNumber);

    // 4. Push-first (v1 workaround #1 — removed when #861 lands). Include
    //    trackingNumber in the patch iff the push succeeded everywhere; on
    //    failure, drop it so the next poll sees the diff and retries.
    if (allDestPushOk) {
      patch.trackingNumber = newTrackingNumber;
    }

    return { didPush: allDestPushOk, patch };
  }

  /**
   * Push `{status:'shipped', trackingNumber}` to each synced destination's
   * `OrderFulfillmentUpdater`. Returns `true` iff every eligible destination
   * accepted the call (i.e., not unsupported and not throwing). Mirrors the
   * resolution path in `ShipmentDispatchNotificationService.updateDestinations`.
   */
  private async pushTrackingToOmps(
    shipment: Shipment,
    trackingNumber: string,
  ): Promise<boolean> {
    const record = await this.orderRecords.getOrderRecord(shipment.orderId);
    const targets = (record?.syncStatus ?? []).filter(
      (s): s is typeof s & { externalOrderId: string } => Boolean(s.externalOrderId),
    );
    if (targets.length === 0) {
      // No destination to push to — vacuously "all-ok"; trackingNumber lands
      // on the Shipment without a downstream call.
      return true;
    }

    let allOk = true;
    for (const entry of targets) {
      try {
        const adapter = await this.integrations.getCapabilityAdapter<OrderProcessorManagerPort>(
          entry.destinationConnectionId,
          ORDER_PROCESSOR_MANAGER_CAPABILITY,
        );
        if (!isOrderFulfillmentUpdater(adapter)) {
          // Destination doesn't implement capability B (yet). Same semantic
          // as #837: skip, don't count as a failure — there's nothing to retry.
          continue;
        }
        await adapter.updateFulfillment({
          externalOrderId: entry.externalOrderId,
          status: 'shipped',
          trackingNumber,
        });
      } catch (error) {
        allOk = false;
        this.logger.warn(
          `OMP push failed for shipment ${shipment.id} dest ${entry.destinationConnectionId}: ${this.message(error)}`,
        );
      }
    }
    return allOk;
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
