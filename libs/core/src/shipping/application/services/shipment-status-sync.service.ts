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
 * The same relay fires a `delivered` event on the delivered transition
 * (#3526), and since #3506 (G02-7) a `delivered` relay that did not land is
 * RE-DRIVEN on later ticks — see `relayDeliveredToParticipants` and
 * `redriveOwedDeliveredRelays`.
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
  ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN,
} from '@openlinker/core/orders';

import type { IShipmentStatusSyncService } from '../interfaces/shipment-status-sync.service.interface';
import { IOrderFulfillmentProjectionService } from '../interfaces/order-fulfillment-projection.service.interface';
import { resolveCarrierHint } from './resolve-carrier-hint';
import { relayWaybillUnderClaim, type WaybillRelayOutcome } from './waybill-relay';
import {
  DELIVERED_RELAY_MAX_AGE_MS,
  DELIVERED_RELAY_MAX_FAILURES,
  DELIVERED_RELAY_REDRIVE_LIMIT,
  DELIVERED_RELAY_RETRY_AFTER_MS,
  type ShipmentStatusSyncOptions,
  type ShipmentStatusSyncResult,
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

/**
 * What one `delivered` relay attempt achieved (#3506, G02-7).
 *
 * - `relayed` — every participant applied it or STRUCTURALLY declined it
 *   (no capability, a platform with no delivered state): nothing to retry.
 * - `failed` — a participant rejected it, could not be constructed
 *   (`adapter-unresolved`, transient by #1947's classification), or the relay
 *   threw before reaching anyone. Retried on a later tick.
 */
type DeliveredRelayOutcome = 'relayed' | 'failed';

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

    const redrive = await this.redriveOwedDeliveredRelays(connectionId);

    return {
      scanned: page.items.length,
      updated,
      propagated,
      failed,
      total: page.total,
      nextOffset,
      deliveredRelaysRetried: redrive.retried,
      deliveredRelaysRecovered: redrive.recovered,
    };
  }

  /**
   * Re-drive the `delivered` relay for this connection's delivered shipments
   * that still owe it (#3506, G02-7) — the bounded second pass after the scan.
   *
   * The scan cannot do this itself: `SCAN_STATUSES` excludes `delivered`, so a
   * shipment whose relay failed on the tick that discovered the transition is
   * never visited again. This pass reads them back by predicate instead
   * (frontier-as-query: a stamped row leaves the set, so there is no cursor),
   * oldest first, bounded three ways:
   *
   * - `DELIVERED_RELAY_REDRIVE_LIMIT` rows per call;
   * - `DELIVERED_RELAY_RETRY_AFTER_MS` since the last failure, which also stops
   *   this pass re-driving a row the scan above failed on a moment ago;
   * - `DELIVERED_RELAY_MAX_FAILURES` attempts, and deliveries older than
   *   `DELIVERED_RELAY_MAX_AGE_MS`, after which the row is given up on and
   *   says so once in the log.
   *
   * A repeat is safe because a `delivered` status write is idempotent on every
   * shipped `OrderStatusWriteback` adapter (see `relayDeliveredToParticipants`).
   *
   * Never throws: this pass is bookkeeping on top of a scan that has already
   * persisted its own results, and a failed read must not fail that scan.
   */
  private async redriveOwedDeliveredRelays(
    connectionId: string,
  ): Promise<{ retried: number; recovered: number }> {
    let owed: readonly Shipment[];
    const now = Date.now();
    try {
      owed = await this.shipments.findDeliveredRelayPending(connectionId, {
        limit: DELIVERED_RELAY_REDRIVE_LIMIT,
        maxFailures: DELIVERED_RELAY_MAX_FAILURES,
        deliveredSince: new Date(now - DELIVERED_RELAY_MAX_AGE_MS),
        lastFailureBefore: new Date(now - DELIVERED_RELAY_RETRY_AFTER_MS),
      });
    } catch (error) {
      this.logger.warn(
        `Could not read the delivered shipments still owed a delivered relay (connection ${connectionId}): ${this.message(error)}`,
      );
      return { retried: 0, recovered: 0 };
    }

    let recovered = 0;
    // Sequential, like the scan: each attempt fans out to every participant.
    for (const shipment of owed) {
      const outcome = await this.relayDeliveredToParticipants(
        shipment,
        shipment.deliveredAt ?? undefined,
      );
      if (outcome === 'relayed') {
        recovered += 1;
      }
    }
    return { retried: owed.length, recovered };
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
    const isNewTransitionIntoDelivered =
      snapshot.status !== shipment.status && snapshot.status === SHIPMENT_STATUS.Delivered;
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

    // #3526 — relay `delivered` to every participant the moment THIS call
    // discovers the transition, independent of whatever the waybill logic
    // below decides (a shipment can be delivered with its waybill already
    // known, so it must not wait on a null→value tracking backfill that will
    // never come). See `relayDeliveredToParticipants` for why this needs no
    // dedicated claim column the way the waybill relay's `waybillRelayedAt`
    // does.
    if (isNewTransitionIntoDelivered) {
      // The SNAPSHOT's instant, never `shipment.deliveredAt` — `shipment` is
      // the pre-patch row this tick loaded, so that field is still `null`
      // here; the carrier's own instant is what `patch.deliveredAt` above was
      // just set from. The outcome is recorded on the row inside the call, so
      // a failure here is re-driven by `redriveOwedDeliveredRelays` later.
      await this.relayDeliveredToParticipants(shipment, snapshot.deliveredAt);
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
   * included (#1947), under the at-most-once claim on `waybillRelayedAt`.
   *
   * The claim, the failure accounting (#2073) and the give-up bound (#3506)
   * live in `relayWaybillUnderClaim`, shared with the source-side fulfilment
   * read-back so both producers of a waybill honour one rule. The carrier hint
   * is this shipment's own provider connection.
   *
   * @returns `'relayed'` on success, `'failed'` when the source could not be
   *          told (claim released, `trackingNumber` withheld so the next tick
   *          retries), `'skipped'` when another caller already holds the claim,
   *          or `'given-up'` when the failure reached WAYBILL_RELAY_MAX_FAILURES
   *          (claim kept, `trackingNumber` saved, never re-driven).
   */
  private relayWaybillToParticipants(
    shipment: Shipment,
    trackingNumber: string,
  ): Promise<WaybillRelayOutcome> {
    return relayWaybillUnderClaim(
      {
        shipments: this.shipments,
        orderLifecycleRelay: this.orderLifecycleRelay,
        logger: this.logger,
      },
      shipment,
      trackingNumber,
      () => resolveCarrierHint(this.integrations, shipment.connectionId, this.logger),
    );
  }

  /**
   * Relay `delivered` to every participant of the order (#3526), and record
   * whether it landed (#3506, G02-7).
   *
   * No claim/release cycle the way the waybill relay has one: that relay's
   * far-side call is a NON-IDEMPOTENT create (`POST /shipments`), whereas
   * setting a platform's own delivered-equivalent status is idempotent on every
   * shipped `OrderStatusWriteback` adapter (writing a status a participant
   * already holds is a no-op there). So two callers racing on one shipment (a
   * poll tick and a carrier webhook both reading the pre-patch row) cost at
   * most a duplicate no-op write, never a duplicate physical action — and the
   * same property is what makes re-driving a failed relay safe.
   *
   * What it does carry is BOOKKEEPING: `deliveredRelayedAt` is stamped once the
   * relay reached every participant that could take it, and a failure bumps
   * `deliveredRelayFailureCount`. Until #3506 a rejection was only logged, and
   * since `SCAN_STATUSES` excludes `delivered` the row was never visited again —
   * a PrestaShop destination that rejected the write (G02-7: no resolvable
   * "delivered" state) stayed "Shipped" until somebody reset the database.
   *
   * On the transition path this runs BEFORE the status patch is written, so the
   * stamp lands first and a relay that succeeds first time never becomes a
   * re-drive candidate.
   *
   * Never throws: neither a relay failure nor a bookkeeping failure may abort
   * `buildPatchAndMaybePush`, which would discard the whole patch — terminal
   * status, deliveredAt, carrier backfill included.
   */
  private async relayDeliveredToParticipants(
    shipment: Shipment,
    deliveredAt: Date | undefined,
  ): Promise<DeliveredRelayOutcome> {
    let outcome: DeliveredRelayOutcome;
    try {
      const result = await this.orderLifecycleRelay.relay({
        internalOrderId: shipment.orderId,
        originConnectionId: shipment.connectionId,
        event: { type: 'delivered', deliveredAt },
      });
      // The same transient/structural split as the waybill relay (#1947): a
      // participant we could not even construct an adapter for is a failure to
      // retry, a participant with no delivered state is a decline to accept.
      const transientlyUnreached = result.targets.filter(
        (t) =>
          t.outcome === 'rejected' ||
          (t.outcome === 'unsupported' && t.unsupportedReason === 'adapter-unresolved'),
      );
      for (const target of transientlyUnreached) {
        this.logger.warn(
          `Delivered relay to ${target.connectionId} failed for shipment ${shipment.id} ` +
            `(${target.outcome}${target.unsupportedReason ? `/${target.unsupportedReason}` : ''})` +
            `${target.detail ? `: ${target.detail}` : ''}`,
        );
      }
      outcome = transientlyUnreached.length > 0 ? 'failed' : 'relayed';
    } catch (error) {
      // The relay reports per-target outcomes rather than throwing, but it CAN
      // throw before its per-target loop (identifier resolution) — the same
      // shape `relayWaybillToParticipants` catches.
      this.logger.warn(
        `Delivered relay threw for shipment ${shipment.id} (order ${shipment.orderId}): ${this.message(error)}`,
      );
      outcome = 'failed';
    }

    await this.recordDeliveredRelayOutcome(shipment.id, outcome);
    return outcome;
  }

  /**
   * Persist a delivered-relay outcome. BEST-EFFORT: a stamp that fails to
   * write leaves the row owed, which costs one idempotent re-drive; a failure
   * count that fails to write costs one retry beyond the bound. Neither is
   * worth failing the poll over.
   */
  private async recordDeliveredRelayOutcome(
    shipmentId: string,
    outcome: DeliveredRelayOutcome,
  ): Promise<void> {
    const at = new Date();
    try {
      if (outcome === 'relayed') {
        await this.shipments.markDeliveredRelayed(shipmentId, at);
        return;
      }
      const failures = await this.shipments.recordDeliveredRelayFailure(shipmentId, at);
      if (failures >= DELIVERED_RELAY_MAX_FAILURES) {
        // Logged once: the row leaves the re-drive frontier at this count.
        this.logger.error(
          `delivered_relay_given_up: shipment ${shipmentId} failed its delivered relay ` +
            `${String(failures)} times and will not be retried; the order's participants may ` +
            'still show it as shipped',
        );
      }
    } catch (error) {
      this.logger.warn(
        `Could not record the delivered-relay outcome (${outcome}) for shipment ${shipmentId}: ${this.message(error)}`,
      );
    }
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
