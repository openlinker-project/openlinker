/**
 * Claimed Waybill Relay Helper
 *
 * Relays a newly-known waybill to every participant of a shipment's order
 * through the role-agnostic lifecycle relay (ADR-027), under the at-most-once
 * claim on `Shipment.waybillRelayedAt` (#1947).
 *
 * Extracted from `ShipmentStatusSyncService` so the source-side fulfilment
 * read-back (`SourceFulfillmentStatusSyncService`) relays a source-observed
 * waybill under the SAME claim, the same failure accounting (#2073) and the
 * same give-up bound (#3506), rather than a second copy of rules that took four
 * issues to get right. The claim is per SHIPMENT row, so the two callers never
 * contend: they write different rows.
 *
 * Claim-then-release, mirroring the webhook dedup gate (which inserts its row
 * before publishing and deletes it on failure so a retry can re-enter): the
 * conditional `claimWaybillRelay` is the serialization point between any two
 * triggers observing the same null→value transition with no lock between them
 * (the carrier poll and the carrier webhook). Claiming only *after* a
 * successful relay would leave that race open, and never claiming would let a
 * retry re-drive the source's non-idempotent waybill POST every tick.
 *
 * The origin of the relay is `shipment.connectionId`, which the relay EXCLUDES:
 * the connection that reported the waybill is never told about it again.
 *
 * A bare colocated helper rather than a service, the `resolve-carrier-hint.ts`
 * precedent: it holds no state and both callers already own every port it
 * needs.
 *
 * @module libs/core/src/shipping/application/services
 */
import type {
  DispatchCarrierHint,
  IOrderLifecycleRelayService,
  OrderLifecycleRelayResult,
} from '@openlinker/core/orders';
import type { LoggerPort } from '@openlinker/shared/logging';

import type { Shipment } from '../../domain/entities/shipment.entity';
import type { ShipmentRepositoryPort } from '../../domain/ports/shipment-repository.port';
import { WAYBILL_RELAY_MAX_FAILURES } from '../types/shipment-status-sync.types';

/**
 * What one claimed waybill relay achieved.
 *
 * - `relayed` - every participant applied it (or structurally declined it).
 * - `failed` - somebody could not be told; the claim is released so a later
 *   trigger retries.
 * - `skipped` - another caller already holds the claim.
 * - `given-up` - the failure reached `WAYBILL_RELAY_MAX_FAILURES`; the claim is
 *   kept so the participants that did apply it stop being re-notified.
 */
export type WaybillRelayOutcome = 'relayed' | 'failed' | 'skipped' | 'given-up';

/** The ports the relay needs, owned by the calling service. */
export interface WaybillRelayDeps {
  readonly shipments: ShipmentRepositoryPort;
  readonly orderLifecycleRelay: IOrderLifecycleRelayService;
  readonly logger: LoggerPort;
}

/**
 * Relay `trackingNumber` for `shipment` under the waybill-relay claim.
 *
 * `resolveCarrier` is a thunk, not a value, so the carrier-hint lookup runs
 * only once the claim is held - a skipped relay costs no metadata read.
 */
export async function relayWaybillUnderClaim(
  deps: WaybillRelayDeps,
  shipment: Shipment,
  trackingNumber: string,
  resolveCarrier: () => Promise<DispatchCarrierHint | undefined>,
): Promise<WaybillRelayOutcome> {
  const claimed = await deps.shipments.claimWaybillRelay(shipment.id, new Date());
  if (!claimed) {
    // Already relayed, or a concurrent trigger won the claim and is relaying
    // right now. Either way this caller must not write to the source; the
    // caller still persists the tracking number itself.
    deps.logger.debug(
      `Waybill relay skipped for shipment ${shipment.id} - already claimed (#1947).`,
    );
    return 'skipped';
  }

  const carrier = await resolveCarrier();

  let result: OrderLifecycleRelayResult;
  try {
    result = await deps.orderLifecycleRelay.relay({
      internalOrderId: shipment.orderId,
      originConnectionId: shipment.connectionId,
      event: { type: 'dispatched', trackingNumber, carrier },
    });
  } catch (error) {
    // The relay reports per-target outcomes rather than throwing, but it CAN
    // throw before its per-target loop (identifier resolution). Catch it here:
    // letting it propagate would abort the caller's per-shipment work (in
    // `ShipmentStatusSyncService`, the whole patch - terminal status,
    // deliveredAt, carrier backfill included - and the order-rollup
    // reprojection).
    // The failure is recorded in the SAME statement that releases the claim
    // (#2073), so this path cannot release without counting. `connectionId`
    // is null because the throw happens BEFORE the per-target loop - there is
    // no participant to name, and inventing one would be a false attribution.
    await deps.shipments.releaseWaybillRelay(shipment.id, {
      reason: 'threw',
      connectionId: null,
      failedAt: new Date(),
    });
    deps.logger.error(
      `Waybill relay threw for shipment ${shipment.id} (order ${shipment.orderId}): ${errorMessage(error)}`,
      error instanceof Error ? error.stack : undefined,
    );
    return 'failed';
  }

  // A target we could not even construct an adapter for is TRANSIENT (#1947):
  // release the claim so a later tick retries rather than recording a delivery
  // that never happened. A structural `no-capability` is not a failure - there
  // is nothing to retry - matching the skip the previous destination-only push
  // performed for a non-`OrderFulfillmentUpdater` destination.
  //
  // NOTE - the claim is released on ANY participant's transient failure, not
  // just the source's, which means a permanently-broken DESTINATION re-drives
  // the source's relay on every tick. That is deliberate, and it is the least
  // bad of three options while notify state is per-shipment rather than
  // per-participant:
  //   - releasing only on a source failure would hold the claim while the
  //     number stays withheld, so the next tick re-detects the diff and then
  //     skips the relay - a livelock in which the number never persists at all;
  //   - persisting the number while holding the claim would permanently lose
  //     destination tracking on one transient blip (the regression that killed
  //     an earlier draft of this fix);
  //   - so we keep today's all-or-nothing retry, and bound the blast radius at
  //     the adapter instead: the Allegro waybill POST now treats a 409 as
  //     already-attached, so a repeat is a no-op rather than a duplicate row.
  // Genuinely per-participant retry is #861. What #3506 adds is a bound in
  // time: after WAYBILL_RELAY_MAX_FAILURES consecutive failures the claim is
  // KEPT and the number persisted, so a destination that will never accept
  // stops re-sending everyone else the dispatch on every tick (seen live: an
  // Allegro order re-notified on each status sync because a dead spike
  // connection kept failing).
  // NOBODY WAS TOLD, so the claim must not stand (#3365 audit).
  //
  // `OrderLifecycleRelayService` answers `{ targets: [] }` when no participant
  // resolves - an order whose `Order` identifier mapping is missing, most
  // commonly. `transientlyUnreached` was then empty, so the code fell through
  // to `clearWaybillRelayFailures` and reported `'relayed'` with
  // `waybillRelayedAt` already claimed and never released: the waybill claim
  // burnt on the first poll tick, the failure counter reading 0, the badge
  // never rendering, and the claim unable to be re-taken. Ever.
  //
  // Released rather than reported as a failure count, because there is no
  // participant to name: the next tick re-claims and tries again, which is
  // what should have happened the first time.
  if (result.targets.length === 0) {
    await deps.shipments.releaseWaybillRelay(shipment.id, {
      reason: 'adapter-unresolved',
      connectionId: null,
      failedAt: new Date(),
    });
    deps.logger.warn(
      `waybill_relay_no_participants shipment=${shipment.id} order=${shipment.orderId} - the ` +
        `relay resolved no participant at all, so nobody was told. The claim is released so ` +
        `the next poll retries; a persistent case is usually a missing Order identifier ` +
        `mapping on the source connection.`,
    );
    return 'failed';
  }

  const transientlyUnreached = result.targets.filter(
    (t) =>
      t.outcome === 'rejected' ||
      (t.outcome === 'unsupported' && t.unsupportedReason === 'adapter-unresolved'),
  );

  if (transientlyUnreached.length > 0) {
    // #2073. The FIRST failing participant is recorded for display; every one
    // of them is still logged individually below, so the log keeps full
    // attribution and the column carries one name for the operator's badge.
    // Nothing reads that name to decide anything - per-target retry state is
    // #861 and this deliberately does not become it.
    //
    // `detail` is NEVER persisted: it is an adapter's free text and can carry
    // a host, a port or a credential fragment, it already reaches the log,
    // and this column reaches a browser - a wider audience (#2341's rule: the
    // code is returned, the message is logged).
    const [first] = transientlyUnreached;
    const failure = {
      reason: first.outcome === 'rejected' ? ('rejected' as const) : ('adapter-unresolved' as const),
      connectionId: first.connectionId,
      failedAt: new Date(),
    };
    const failures = (shipment.waybillRelayFailure?.count ?? 0) + 1;
    const givingUp = failures >= WAYBILL_RELAY_MAX_FAILURES;
    if (givingUp) {
      await deps.shipments.giveUpWaybillRelay(shipment.id, failure);
    } else {
      await deps.shipments.releaseWaybillRelay(shipment.id, failure);
    }
    for (const target of transientlyUnreached) {
      // The poll job deliberately stays `succeeded` (the next tick retries).
      // Since #2073 this log line is no longer the ONLY observable signal -
      // the shipment now carries a durable consecutive-failure count that the
      // `/shipments` read surface escalates past a threshold - but it is
      // still the only place the per-target detail appears, so it stays at
      // `error` level for triage.
      deps.logger.error(
        `Waybill relay to ${target.connectionId} failed for shipment ${shipment.id} ` +
          `(${target.outcome}${target.unsupportedReason ? `/${target.unsupportedReason}` : ''})` +
          `${target.detail ? `: ${target.detail}` : ''}`,
      );
    }
    if (givingUp) {
      // Logged once: the kept claim takes the row out of every later relay.
      deps.logger.error(
        `waybill_relay_given_up: shipment ${shipment.id} (order ${shipment.orderId}) failed its ` +
          `waybill relay ${String(failures)} times in a row; the claim is kept so its participants ` +
          `stop being re-notified, and the tracking number is saved. Still unreached: ` +
          `${transientlyUnreached.map((t) => t.connectionId).join(', ')}`,
      );
      return 'given-up';
    }
    return 'failed';
  }

  // The relay reached every participant, so the failure history is cleared
  // (#2073) - without this the escalation is an alarm that never goes off.
  //
  // BEST-EFFORT, unlike the increment above. The increment is fused to a
  // release that was already un-caught, so it adds no failure mode; this is a
  // genuinely new write on a path that has ALREADY succeeded durably, and
  // failing the relay because its bookkeeping failed would let the recording
  // of a success destroy the success. A stale count simply escalates one
  // shipment that has recovered, which the next successful relay clears.
  try {
    await deps.shipments.clearWaybillRelayFailures(shipment.id);
  } catch (error) {
    deps.logger.warn(
      `Failed to clear waybill relay failure history for shipment ${shipment.id} ` +
        `(non-fatal, the relay itself succeeded): ${errorMessage(error)}`,
    );
  }

  return 'relayed';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
