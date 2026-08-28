/**
 * Unavailable Order-Hold Reader (#2346)
 *
 * The Wave-2 stand-in for the `'open-order-hold'` obligation kind: the
 * `order_holds` table (#2339) is not present on THIS branch, so this reader
 * cannot see the data that would answer the question and says so — every call
 * returns `'indeterminate'`.
 *
 * **Consequence, stated plainly: while this is bound, the expiry sweep extends
 * every candidate and releases nothing.** That is the deliberate fail-closed
 * posture (REVIEW § 3 C1), not a defect, and it is asserted by this class's own
 * spec so that forgetting to replace it stays safe.
 *
 * It matters more than it reads, because the sweep is the DESIGNED close path
 * for an order OpenLinker does not fulfil itself: the other two closers both
 * need an OL-side event (a cancellation, or an OL-owned `Shipment` shipping)
 * that never occurs on the default `omp_fulfilled` topology, where the
 * marketplace ships and OL creates no `Shipment`. See the binding site in
 * `inventory.module.ts` for the full statement of what accumulates and why it
 * is contained.
 *
 * ## Replacing this (#2339)
 *
 * The table is no longer the blocker — body A shipped `order_holds` earlier in
 * this same wave (PR #2588). This branch simply does not contain that body, so
 * the swap is a WAVE-LEVEL integration step taken once both sit on
 * `oms-programme-wave-2`, not something this branch can do.
 *
 * Bind a reader that returns `'present'` for an open `order_holds` row and
 * `'absent'` **only when it has positively confirmed there is none**. Never
 * return `'absent'` as a default, as the fallback arm of a failed read, or for
 * an order it could not find — that single shortcut converts the fail-closed
 * design into a silent oversell, which is the exact failure this whole module
 * exists to prevent.
 *
 * @module libs/core/src/inventory/infrastructure/reservations
 */
import { Injectable } from '@nestjs/common';
import type { ObligationVerdict } from '../../domain/types/reservation-obligation.types';

@Injectable()
export class UnavailableOrderHoldReader {
  /**
   * `'indeterminate'`, always — there is no hold source to consult.
   *
   * The parameter is part of the {@link ObligationReader} contract the real
   * implementation will honour; it is unused here precisely because this reader
   * has nothing to look the order up in.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the signature is the contract; #2339's reader uses it.
  read(_orderRecordId: string): Promise<ObligationVerdict> {
    return Promise.resolve('indeterminate');
  }
}
