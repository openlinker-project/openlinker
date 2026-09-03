/**
 * Shipment Status Sync Service
 *
 * Cursor-based poll over OL's own `Shipment`s for one shipping-provider
 * connection (#838). For each non-terminal shipment it (1) reads the carrier's
 * `TrackingSnapshot` via `ShippingProviderManagerPort.getTracking`, (2) builds
 * a patch reflecting carrier reality (status into terminal states +
 * trackingNumber backfill), and (3) relays a newly-arrived waybill to **every**
 * participant of the order — the source marketplace included — through the
 * single role-agnostic `OrderStatusWriteback` lifecycle relay (#1168 / ADR-027).
 *
 * Mirrors `OfferStatusSyncService` (#816): the service returns scan stats; the
 * caller (worker handler) advances the persisted `connection_cursors` offset.
 *
 * **Why the relay, not a destination push (#1947).** Until this change step (3)
 * resolved `record.syncStatus` + `OrderProcessorManager`/`OrderFulfillmentUpdater`
 * — destinations only. A source adapter (Allegro, Erli) implements neither, so a
 * waybill minted *after* the operator dispatched could never reach the
 * marketplace: it showed the order as shipped while still asking the seller to
 * add tracking numbers, permanently. This was the last pre-#1168 destination-only
 * writer. Destinations lose nothing by the swap — both shop adapters'
 * `write({type:'dispatched'})` delegates verbatim to
 * `updateFulfillment({status:'shipped', trackingNumber})`.
 *
 * **The two roles of `trackingNumber` are now split.** It used to be both the
 * data and the retry marker for every participant, which forced a choice between
 * re-driving the source's non-idempotent waybill POST on every tick and
 * permanently losing the number. So:
 *
 * - `Shipment.trackingNumber` is DATA — persisted whenever the source relay did
 *   not fail. Destination failures stay best-effort and never withhold it.
 * - `Shipment.waybillRelayedAt` is the source-relay CLAIM — taken conditionally,
 *   released on failure. At-most-once is a database fact, and the conditional
 *   claim is also what serializes the poll against the carrier webhook (both
 *   observe the same null→value transition with no lock between them).
 *
 * Generalised per-destination notify state remains #861; this single marker is
 * the first row of that model.
 *
 * **The dispatched-gate stays**: while a shipment is `generated`, only the data
 * field is backfilled — `ShipmentDispatchNotificationService` owns that
 * transition and its own at-most-once notify, and #838 must not race it.
 *
 * @module libs/core/src/shipping/application/services
 * @implements {IShipmentStatusSyncService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import {
  type IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
} from '@openlinker/core/integrations';
import {
  type IOrderLifecycleRelayService,
  type OrderLifecycleRelayResult,
  ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN,
} from '@openlinker/core/orders';

import type { IShipmentStatusSyncService } from '../interfaces/shipment-status-sync.service.interface';
import { IOrderFulfillmentProjectionService } from '../interfaces/order-fulfillment-projection.service.interface';
import { resolveCarrierHint } from './resolve-carrier-hint';
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
import {
  ORDER_FULFILLMENT_PROJECTION_SERVICE_TOKEN,
  SHIPMENT_REPOSITORY_TOKEN,
} from '../../shipping.tokens';

const SHIPPING_PROVIDER_MANAGER_CAPABILITY = 'ShippingProviderManager';

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
 * Statuses from which the waybill relay is allowed. At `generated` we still
 * backfill `Shipment.trackingNumber` but defer notifying anyone to #837's
 * `notifyDispatched`, which owns that transition and its own at-most-once gate.
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
    // #1947: the waybill goes to every participant through the single
    // role-agnostic relay (ADR-027), which resolves targets from the Order
    // identifier mappings — so `IOrderRecordService` is no longer needed here.
    @Inject(ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN)
    private readonly orderLifecycleRelay: IOrderLifecycleRelayService,
    @Inject(ORDER_FULFILLMENT_PROJECTION_SERVICE_TOKEN)
    private readonly fulfillmentProjection: IOrderFulfillmentProjectionService,
  ) {}

  async sync(
    connectionId: string,
    options: ShipmentStatusSyncOptions,
  ): Promise<ShipmentStatusSyncResult> {
    const offset = options.offset ?? 0;
    const { limit } = options;

    const page = await this.shipments.findMany(
      // `direction` is passed EXPLICITLY rather than inherited (#2373):
      // `ShipmentFilters.direction` is optional so the operator-facing
      // `/shipments` list can show every cohort, which means this scan has to
      // state the one it polls.
      { connectionId, statuses: SCAN_STATUSES, direction: 'outbound' },
      { offset, limit },
    );

    let updated = 0;
    let propagated = 0;
    let failed = 0;

    let carrierAdapter: ShippingProviderManagerPort | null = null;

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
          // A terminal-status change moves the order rollup (#1108) — reproject.
          if (patch.status) {
            await this.fulfillmentProjection.recompute(shipment.orderId);
          }
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

  async syncOneByProviderShipmentId(
    connectionId: string,
    providerShipmentId: string,
  ): Promise<void> {
    const shipment = await this.shipments.findByProviderShipmentId(providerShipmentId);
    if (!shipment) {
      this.logger.warn(
        `Webhook-triggered shipment refresh: no shipment for providerShipmentId=${providerShipmentId} (connection ${connectionId}) — ignoring.`,
      );
      return;
    }
    // Cross-connection guard (ADR-021): a webhook delivered for connection A
    // must never refresh a shipment owned by connection B, even if provider
    // shipment ids collide across multi-account connections (#727 v2).
    if (shipment.connectionId !== connectionId) {
      this.logger.warn(
        `Webhook-triggered shipment refresh: providerShipmentId=${providerShipmentId} resolved to shipment ${shipment.id} on connection ${shipment.connectionId}, not the webhook's connection ${connectionId} — skipping.`,
      );
      return;
    }

    const carrierAdapter =
      await this.integrations.getCapabilityAdapter<ShippingProviderManagerPort>(
        connectionId,
        SHIPPING_PROVIDER_MANAGER_CAPABILITY,
      );
    const snapshot = await carrierAdapter.getTracking({ providerShipmentId });

    const { patch } = await this.buildPatchAndMaybePush(shipment, snapshot);
    if (Object.keys(patch).length > 0) {
      await this.shipments.update(shipment.id, patch);
      if (patch.status) {
        await this.fulfillmentProjection.recompute(shipment.orderId);
      }
    }
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

    // 2a. Carrier-of-record — backfill on null → value transition (#769).
    //    Same null→value discipline as `trackingNumber`. Once written, never
    //    overwritten — cancel + re-issue is the operator workflow if a
    //    mid-flight carrier swap is ever needed. Independent of the
    //    push-first workaround on trackingNumber: the carrier field is
    //    passive (no OMP projection depends on it directly) and lands
    //    whenever the snapshot surfaces it.
    if (shipment.carrier === null && typeof snapshot.carrier === 'string' && snapshot.carrier.length > 0) {
      patch.carrier = snapshot.carrier;
    }

    // 2b. Tracking number — backfill on null → value transition. Carriers that
    //    deliver waybills asynchronously populate this on a later poll: InPost
    //    ShipX mints it at confirmation (#1947), Allegro Delivery brokers it
    //    (#833). Same `length > 0` normalization as 2a above — empty string is
    //    semantically equivalent to "no waybill yet", so don't take the
    //    irreversible null→empty step.
    const newTrackingNumber =
      shipment.trackingNumber === null &&
      typeof snapshot.trackingNumber === 'string' &&
      snapshot.trackingNumber.length > 0
        ? snapshot.trackingNumber
        : null;

    if (newTrackingNumber === null) {
      return { didPush: false, patch };
    }

    // 3. Terminal-status guard (#1947). Step 1 above may have patched `status`
    //    from the snapshot, while the gate below reads the PRE-patch status. A
    //    shipment whose snapshot arrives as `cancelled`/`failed` carrying its
    //    first waybill must NOT be announced as dispatched — that would mark the
    //    marketplace order sent and attach a waybill for a parcel that will never
    //    move, plus notify the buyer.
    //
    //    `delivered` is deliberately NOT in this guard even though it is also
    //    terminal: one snapshot can legitimately carry `delivered` together with
    //    the first waybill (30-minute poll, tracking minted at confirmation), and
    //    a delivered parcel unambiguously shipped. Skipping it would consume the
    //    null→value transition and lose the waybill forever on the FASTEST
    //    orders. `FulfillmentStatusSyncService.isInitialDispatch` treats
    //    dispatched-or-delivered as relayable for the same reason — match it.
    if (patch.status === SHIPMENT_STATUS.Cancelled || patch.status === SHIPMENT_STATUS.Failed) {
      patch.trackingNumber = newTrackingNumber;
      return { didPush: false, patch };
    }

    // 4. Gate deferring to the operator-dispatch path. For a `generated`
    //    shipment we still backfill the data field so #837's `notifyDispatched`
    //    reads it; that service owns the `generated → dispatched` transition and
    //    its own at-most-once notify.
    if (!PUSH_GATE_OPEN_FROM.includes(shipment.status)) {
      patch.trackingNumber = newTrackingNumber;
      return { didPush: false, patch };
    }

    // 5. Relay the waybill to EVERY order participant — the source marketplace
    //    included (#1947). Replaces the pre-#1168 destination-only push that
    //    resolved `record.syncStatus` + `OrderFulfillmentUpdater`: a source
    //    adapter implements neither, so the waybill could never reach it, which
    //    is the whole defect. Destinations lose nothing — both shop adapters'
    //    `write({type:'dispatched'})` delegates verbatim to
    //    `updateFulfillment({status:'shipped', trackingNumber})`.
    const relayedToSource = await this.relayWaybillToParticipants(shipment, newTrackingNumber);

    // 6. `trackingNumber` is pure DATA and is persisted whenever the source
    //    relay did not fail — at-most-once for the source lives on
    //    `waybillRelayedAt`, not on this field. Destination outcomes stay
    //    best-effort (logged, never blocking), exactly as before.
    if (relayedToSource !== 'failed') {
      patch.trackingNumber = newTrackingNumber;
    }

    return { didPush: relayedToSource === 'relayed', patch };
  }

  /**
   * Relay a newly-known waybill to every participant of the order, source
   * included (#1947), under an at-most-once claim.
   *
   * Claim-then-release, mirroring the webhook dedup gate (which inserts its row
   * before publishing and deletes it on failure so a retry can re-enter): the
   * conditional `claimWaybillRelay` is the serialization point between the poll
   * and the carrier webhook, which both observe the same null→value transition
   * with no lock between them. Claiming only *after* a successful relay would
   * leave that race open, and never claiming would let a retry re-drive the
   * source's non-idempotent waybill POST every tick.
   *
   * @returns `'relayed'` on success, `'failed'` when the source could not be
   *          told (claim released, `trackingNumber` withheld so the next tick
   *          retries), or `'skipped'` when another caller already holds the claim.
   */
  private async relayWaybillToParticipants(
    shipment: Shipment,
    trackingNumber: string,
  ): Promise<'relayed' | 'failed' | 'skipped'> {
    const claimed = await this.shipments.claimWaybillRelay(shipment.id, new Date());
    if (!claimed) {
      // Already relayed, or a concurrent trigger won the claim and is relaying
      // right now. Either way this caller must not write to the source; the
      // tracking number itself still lands (step 6).
      this.logger.debug(
        `Waybill relay skipped for shipment ${shipment.id} — already claimed (#1947).`,
      );
      return 'skipped';
    }

    const carrier = await resolveCarrierHint(this.integrations, shipment.connectionId, this.logger);

    let result: OrderLifecycleRelayResult;
    try {
      result = await this.orderLifecycleRelay.relay({
        internalOrderId: shipment.orderId,
        originConnectionId: shipment.connectionId,
        event: { type: 'dispatched', trackingNumber, carrier },
      });
    } catch (error) {
      // The relay reports per-target outcomes rather than throwing, but it CAN
      // throw before its per-target loop (identifier resolution). Catch it here:
      // letting it propagate would abort `buildPatchAndMaybePush` and discard the
      // whole patch — terminal status, deliveredAt, carrier backfill included —
      // and skip the order-rollup reprojection.
      await this.shipments.releaseWaybillRelay(shipment.id);
      this.logger.error(
        `Waybill relay threw for shipment ${shipment.id} (order ${shipment.orderId}): ${this.message(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      return 'failed';
    }

    // A target we could not even construct an adapter for is TRANSIENT (#1947):
    // release the claim so a later tick retries rather than recording a delivery
    // that never happened. A structural `no-capability` is not a failure — there
    // is nothing to retry — matching the skip the previous destination-only push
    // performed for a non-`OrderFulfillmentUpdater` destination.
    //
    // NOTE — the claim is released on ANY participant's transient failure, not
    // just the source's, which means a permanently-broken DESTINATION re-drives
    // the source's relay on every tick. That is deliberate, and it is the least
    // bad of three options while notify state is per-shipment rather than
    // per-participant:
    //   - releasing only on a source failure would hold the claim while the
    //     number stays withheld, so the next tick re-detects the diff and then
    //     skips the relay — a livelock in which the number never persists at all;
    //   - persisting the number while holding the claim would permanently lose
    //     destination tracking on one transient blip (the regression that killed
    //     an earlier draft of this fix);
    //   - so we keep today's all-or-nothing retry, and bound the blast radius at
    //     the adapter instead: the Allegro waybill POST now treats a 409 as
    //     already-attached, so a repeat is a no-op rather than a duplicate row.
    // Genuinely per-participant retry is #861.
    const transientlyUnreached = result.targets.filter(
      (t) =>
        t.outcome === 'rejected' ||
        (t.outcome === 'unsupported' && t.unsupportedReason === 'adapter-unresolved'),
    );

    if (transientlyUnreached.length > 0) {
      await this.shipments.releaseWaybillRelay(shipment.id);
      for (const target of transientlyUnreached) {
        // The poll job deliberately stays `succeeded` (the next tick retries), so
        // this log line is the only observable signal — `error` level for triage.
        this.logger.error(
          `Waybill relay to ${target.connectionId} failed for shipment ${shipment.id} ` +
            `(${target.outcome}${target.unsupportedReason ? `/${target.unsupportedReason}` : ''})` +
            `${target.detail ? `: ${target.detail}` : ''}`,
        );
      }
      return 'failed';
    }

    return 'relayed';
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
