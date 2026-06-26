/**
 * Dispatch Carrier Hint
 *
 * Neutral carrier reference carried on the `OrderStatusWriteback` `dispatched`
 * event when attaching a waybill to the order source. The orchestration sources
 * it from the shipping processor connection's `platformType` (a stable carrier
 * identity for an own-contract single-carrier integration, e.g. `'inpost'`);
 * the source adapter maps it to its own carrier vocabulary (#837 Q5).
 *
 * Kept platform-agnostic by design — the core never knows a given marketplace's
 * carrier id set; that mapping lives behind the source adapter.
 *
 * @module libs/core/src/orders/domain/types
 */
export interface DispatchCarrierHint {
  /**
   * The shipping processor connection's `platformType` (e.g. `'inpost'`).
   *
   * NOTE: `platformType` ≈ carrier holds for own-contract single-carrier
   * integrations (today's only waybill-attaching branch). A future multi-carrier
   * broker integration would need a richer carrier identity sourced from the
   * shipping adapter — extend this type then, not the call sites.
   */
  platformType: string;
}
