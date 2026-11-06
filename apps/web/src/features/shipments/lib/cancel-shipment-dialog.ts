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
 * The words live in the `shipments.cancelShipment` copy and are read when the
 * function runs, so they follow the active language (ADR-081).
 *
 * @module apps/web/src/features/shipments/lib
 */
import { getMessages, interpolate } from '../../../shared/i18n';
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
  const copy = getMessages('shipments').cancelShipment;
  return {
    effect: interpolate(copy.effect, { carrier: carrierName }),
    alsoOutstanding: status === 'dispatched' ? copy.alsoOutstanding : null,
  };
}
