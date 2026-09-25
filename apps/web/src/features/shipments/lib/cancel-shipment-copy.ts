/**
 * Cancel-shipment confirm copy
 *
 * ONE source for the cancel dialog's body, because there are two dialogs -
 * the shipments row detail and the order's action buttons - and they carried
 * near-identical sentences already. Since #3365 the sentence depends on the
 * shipment's status, and a status-dependent sentence duplicated across two
 * files is one that will eventually exist in one of them only.
 *
 * The extra warning fires BEFORE the act rather than reporting after it. The
 * operator is the one who decides whether a voided label is worth an
 * unwithdrawable notification, and they can only decide it beforehand.
 *
 * @module apps/web/src/features/shipments/lib
 */
import type { ShipmentStatus } from '../api/shipments.types';

export interface CancelShipmentCopy {
  /** What voiding the label does, always shown. */
  effect: string;
  /**
   * What cancelling ALSO leaves outstanding, or null when it leaves nothing.
   *
   * Non-null only after dispatch: the channel has already been told the parcel
   * shipped, and OpenLinker sends nothing to withdraw that - the only
   * cancellation event it has says the customer's order was cancelled, which
   * is a different thing and usually untrue here.
   */
  alsoOutstanding: string | null;
}

export function cancelShipmentCopy(
  status: ShipmentStatus,
  carrierName: string
): CancelShipmentCopy {
  return {
    effect:
      `The label will be voided with ${carrierName}. This cannot be undone — to ship this ` +
      `order again you'll need to generate a new label.`,
    alsoOutstanding:
      status === 'dispatched'
        ? 'This shipment was already marked as dispatched, so the sales channel has been told ' +
          'the parcel is on its way. OpenLinker cannot take that back for you — tell the ' +
          'channel yourself after cancelling.'
        : null,
  };
}
