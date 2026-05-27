/**
 * Shipment Dispatch Notification Types
 *
 * Input/result contract for `IShipmentDispatchNotificationService.notifyDispatched`
 * (#837, spec step 5). Inline unions (not `as const`) — this is an internal
 * service result, not a wire/DB type, mirroring `ShipmentDispatchResult`.
 *
 * @module libs/core/src/shipping/application/types
 */

export interface ShipmentDispatchNotificationInput {
  /** Internal Shipment id (`ol_shipment_*`) that has reached `generated`. */
  shipmentId: string;
}

/**
 * Per-target outcome. `source` is the order-source notify (A); `destinations`
 * are the per-OMP fulfillment updates (B, best-effort). `outcome` is the
 * top-level disposition.
 */
export interface ShipmentDispatchNotificationResult {
  shipmentId: string;
  /**
   * - `notified` — the shipment was `generated` and the notify ran.
   * - `skipped-not-generated` — the status-gate skipped it (already dispatched/terminal).
   * - `shipment-not-found` — no shipment for the id.
   */
  outcome: 'notified' | 'skipped-not-generated' | 'shipment-not-found';
  /** Source mark-sent: `absent` = no source / source doesn't implement the capability. */
  source: 'ok' | 'failed' | 'absent';
  destinations: ReadonlyArray<{
    connectionId: string;
    status: 'ok' | 'failed' | 'unsupported';
  }>;
}
