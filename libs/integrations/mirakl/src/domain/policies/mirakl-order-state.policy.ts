/**
 * Mirakl Order State Policy
 *
 * Which Mirakl order states mean what for the fulfilment writeback and
 * readback (#4276). Mirakl moves an order through `SHIPPING` (accepted, to be
 * sent), `SHIPPED`, `TO_COLLECT` (waiting at a pickup point), `RECEIVED` and
 * `CLOSED`; `CANCELED` and `REFUSED` end it without a shipment.
 *
 * @module libs/integrations/mirakl/src/domain/policies
 */

/** States in which the parcel has left the seller. */
export const DISPATCHED_ORDER_STATES: readonly string[] = [
  'SHIPPED',
  'TO_COLLECT',
  'RECEIVED',
  'CLOSED',
];

/** States in which the order ended without a shipment. */
export const CANCELLED_ORDER_STATES: readonly string[] = ['CANCELED', 'REFUSED'];

/** States before shipping; an order here is not dispatched yet. */
const NOT_DISPATCHED_ORDER_STATES: readonly string[] = [
  'STAGING',
  'WAITING_ACCEPTANCE',
  'WAITING_DEBIT',
  'WAITING_DEBIT_PAYMENT',
  'SHIPPING',
];

/** The one state OR24 ships from. */
export const READY_TO_SHIP_ORDER_STATE = 'SHIPPING';

/**
 * Whether the order has been dispatched. `null` for a state this plugin does
 * not know, which a caller must read as "unknown", never as "not sent".
 */
export function isDispatchedOrderState(state: string | undefined): boolean | null {
  if (!state) return null;
  if (DISPATCHED_ORDER_STATES.includes(state)) return true;
  if (NOT_DISPATCHED_ORDER_STATES.includes(state) || CANCELLED_ORDER_STATES.includes(state)) {
    return false;
  }
  return null;
}
