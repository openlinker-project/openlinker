/**
 * Shipment Dispatch Notification Types
 *
 * Input/result contract for `IShipmentDispatchNotificationService.notifyDispatched`
 * (#837, spec step 5). Inline unions (not `as const`) — this is an internal
 * service result, not a wire/DB type, mirroring `ShipmentDispatchResult`. Since
 * #1168 the cross-system writes run through the lifecycle relay; these outcomes
 * are re-labelled from the relay's role-agnostic per-target results.
 *
 * @module libs/core/src/shipping/application/types
 */

export interface ShipmentDispatchNotificationInput {
  /** Internal Shipment id (`ol_shipment_*`) that has reached `generated`. */
  shipmentId: string;
}

/** Source mark-sent: `absent` = no source / source has no writeback capability. */
export type DispatchNotificationSourceOutcome = 'ok' | 'failed' | 'absent';

/** Per-destination fulfillment update (best-effort). */
export interface DispatchNotificationDestinationOutcome {
  connectionId: string;
  status: 'ok' | 'failed' | 'unsupported';
}

/**
 * Per-target outcome. `source` is the order-source writeback; `destinations`
 * are the per-OMP fulfillment updates (best-effort). `outcome` is the top-level
 * disposition. Both are re-labelled from the lifecycle relay's per-target
 * results by connection id (#1168).
 */
export interface ShipmentDispatchNotificationResult {
  shipmentId: string;
  /**
   * - `notified` — the shipment was `generated` and the notify ran.
   * - `skipped-not-generated` — the status-gate skipped it (already dispatched/terminal).
   * - `shipment-not-found` — no shipment for the id.
   */
  outcome: 'notified' | 'skipped-not-generated' | 'shipment-not-found';
  source: DispatchNotificationSourceOutcome;
  destinations: ReadonlyArray<DispatchNotificationDestinationOutcome>;
}
