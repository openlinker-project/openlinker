/**
 * Order Hold Projection Repository Port (#2340, DESIGN §6.3)
 *
 * Persistence contract for `order_records.activeHoldReason` — the denormalised
 * cache of "which hold, if any, is open on this order".
 *
 * ## The one rule
 *
 * **`order_holds` is the authority; this column is a CACHE that loses on drift,
 * and NO HOLD GATE MAY READ IT.** Both #2339 gates (provisioning, dispatch) call
 * `IOrderHoldService.getOpenHold`, which reads the table. That is the epic's L4
 * exit criterion, and it is stated here because the next reader will be tempted
 * by the cheaper column: a cache with a staleness window must never decide
 * whether a parcel leaves the building. The only consumers are the derived
 * lifecycle phase (#2307) and its SQL twin (#2309) — display and filter facts,
 * where a stale badge is a bounded, self-repairing cost.
 *
 * ## Two callers, one statement, and one difference between them
 *
 * {@link setActiveHoldReason} is a narrow absolute set — the
 * `updateSalesDocumentBlock` (#2100) shape, including the `IS DISTINCT FROM`
 * no-op guard that keeps the `@UpdateDateColumn` bump off the unchanged path
 * without giving up last-write-wins. It is **level-triggered**: storing `null`
 * is what clears a stale value, so `release()` writes `null` rather than
 * skipping the write.
 *
 * The AUTHORITY path (`OrderHoldService.place` / `.release`) writes
 * unconditionally. The RECONCILE path passes `ifCurrentlyIs`, making the write a
 * compare-and-set — see that option.
 *
 * This port is INTRA-context and deliberately NOT exported from
 * `@openlinker/core/orders` — the `OrderHoldRepositoryPort` precedent.
 *
 * @module libs/core/src/orders/domain/ports
 */
import type { HoldReason } from '@openlinker/core/order-lifecycle';
import type { HoldProjectionDivergence } from '../types/order-hold-projection.types';

export interface SetActiveHoldReasonOptions {
  /**
   * Apply the write only while `order_holds` still carries NO open hold for
   * this order (`NOT EXISTS`, evaluated inside the same statement).
   *
   * **This is what makes the reconcile pass's CLEAR arm race-free, and
   * `ifCurrentlyIs` alone was not.** The compare-and-set compares a VALUE, not a
   * version: a missed clear witnessed as `'operator'` still matches
   * `ifCurrentlyIs: 'operator'` after a genuinely NEW `'operator'` hold was
   * placed in between, so the repair wrote `null` over a live hold and left the
   * order reading un-held for up to an hour. Conditioning on the AUTHORITY
   * instead removes the window by construction rather than narrowing it.
   *
   * Passed only when repairing towards `null`; setting a reason is already
   * guarded by the open hold the pass just read.
   */
  requireNoOpenHold?: boolean;

  /**
   * Compare-and-set witness: apply the write only while the column still holds
   * this exact value (NULL-safe, via `IS NOT DISTINCT FROM`).
   *
   * **Passed ONLY by the reconcile pass, and it is load-bearing there.** That
   * pass reads `(open hold, projection)` and writes the expected value
   * afterwards; a `release()` committing in between would otherwise have its
   * clear overwritten with the released hold's reason — the cache contradicting
   * the authority in exactly the direction the pass exists to prevent. The
   * shape is `ShipmentRepository.claimWaybillRelay`'s conditional write,
   * widened from `IsNull()` because the observed value may be a reason.
   *
   * Omitted by `place` / `release`, which ARE the authority and must not be
   * conditional on what a stale reconcile left behind.
   */
  ifCurrentlyIs: string | null;
}

export interface OrderHoldProjectionRepositoryPort {
  /**
   * Set or clear the projection for one order.
   *
   * @returns whether a row actually changed. `false` means either the value was
   *   already correct (the no-op guard) or — with `ifCurrentlyIs` — a peer wrote
   *   first. The reconcile pass distinguishes the second case as `superseded`;
   *   the authority path ignores the return.
   */
  setActiveHoldReason(
    internalOrderId: string,
    reason: HoldReason | null,
    options?: SetActiveHoldReasonOptions
  ): Promise<boolean>;

  /**
   * One bounded page of orders whose projection disagrees with `order_holds`.
   *
   * **Frontier-as-query, NOT scan-offset.** Every repair CONSUMES its own
   * selection — a corrected row leaves this predicate — so an advancing offset
   * over a shrinking set would step over rows silently. `bounded-sweep.ts`'s own
   * header draws that distinction, and `InventoryProvenanceBackfillHandler`
   * (#2317) is the shipped precedent for answering it this way.
   *
   * **Divergence is bidirectional and both directions are read**, which is why
   * the candidate set is a UNION rather than a walk over open holds:
   *
   * - an open hold whose projection is absent or wrong — a missed `place` write;
   * - a non-null projection with NO open hold — a missed `release` clear, the
   *   direction that otherwise strands an order reading `held` forever.
   *
   * Both arms are index-served (`UQ_order_holds_open_order` and the partial
   * `IDX_order_records_active_hold`) and both are bounded by "orders currently
   * held or currently marked held", so this never approaches a table scan.
   *
   * Ordered by `internalOrderId` for determinism.
   */
  findDivergentProjections(limit: number): Promise<HoldProjectionDivergence[]>;
}
