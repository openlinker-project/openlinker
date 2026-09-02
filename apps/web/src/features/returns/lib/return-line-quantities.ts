/**
 * Return line quantity derivations (#2380)
 *
 * The three questions both inline custody forms, the line row and the bulk
 * action all ask of a line — and they must all get the SAME answer, or a form
 * defaults to a quantity the row says is impossible.
 *
 * Each mirrors a bound the server also enforces. They are derivations of
 * counters already on the line, not a second source of truth: the server stays
 * the authority and its 409 is rendered, but the operator is told before they
 * submit rather than after.
 *
 * @module apps/web/src/features/returns/lib
 */
import type { ReturnLine } from '../api/returns.types';

/**
 * Units still expected on this line.
 *
 * The bound `over-receipt` enforces. Floored at zero so a line whose counters
 * were already reconciled elsewhere never yields a negative default.
 */
export function outstandingToReceive(line: ReturnLine): number {
  return Math.max(0, line.quantityAdvised - line.quantityReceived);
}

/**
 * Received units not yet restocked or scrapped.
 *
 * The bound `over-disposition` enforces. Note this counts units whose restock
 * was BLOCKED as still outstanding, which is correct and deliberate: a blocked
 * restock leaves its units in `quantityReceived` precisely so nothing reports
 * them as dealt with.
 */
export function outstandingToDispose(line: ReturnLine): number {
  return Math.max(0, line.quantityReceived - line.quantityRestocked - line.quantityScrapped);
}

/**
 * May this line be written off as not returned?
 *
 * Gated on nothing having arrived, which is the model's own rule (#2367): a
 * partially received line still holds goods needing a disposition, and there is
 * no counter for a shortfall to move into. Gating the CONTROL on it is what
 * stops the operator discovering that refusal by clicking.
 *
 * `quantityAdvised > 0` is here for the same reason the domain rule refuses it:
 * the act carries the shortfall as its quantity, and a zero has nothing to
 * write off.
 */
export function canMarkNotReturned(line: ReturnLine): boolean {
  return (
    line.quantityReceived === 0 &&
    line.quantityAdvised > 0 &&
    (line.custodyState === 'advised' || line.custodyState === 'in_transit')
  );
}
