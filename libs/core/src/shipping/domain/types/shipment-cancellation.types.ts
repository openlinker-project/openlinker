/**
 * Shipment Cancellation Types
 *
 * What a cancellation reports back, beyond the row it produced.
 *
 * It exists because the window widened to include `dispatched` (#3365) and the
 * two halves of that window are not equivalent. Cancelling a `draft` or
 * `generated` shipment is a clean void: nobody outside OpenLinker has been told
 * anything. Cancelling a `dispatched` one is not, because reaching that status
 * IS the record that the dispatch notification ran -
 * `ShipmentDispatchNotificationService` advances the row only when the source
 * accepted the event or there was no source to accept it.
 *
 * **OpenLinker does not un-tell the source, and this type is why.** There is no
 * event for it: `OrderLifecycleEvent` carries `dispatched` and `cancelled`, and
 * `cancelled` means the BUYER'S ORDER is cancelled - a different and usually
 * false claim when an operator merely voided a label, and one the contract
 * itself says a participant may reject after shipping. So the cancellation
 * reports the fact and leaves the sentence about its consequence to the surface
 * that speaks to the operator.
 *
 * @module libs/core/src/shipping/domain/types
 */
import type { Shipment } from '../entities/shipment.entity';

export interface ShipmentCancellationResult {
  /** The cancelled row. */
  shipment: Shipment;

  /**
   * The shipment had already reached `dispatched` when the cancellation was
   * requested.
   *
   * A FACT, not an inference: it says the dispatch notification had already
   * run, which is the only thing the row can attest to. It deliberately does
   * NOT claim the marketplace was told - the notification advances the row both
   * when the source applied the event and when there was no source to apply it,
   * and the row does not record which. A surface phrasing this for an operator
   * should say what is outstanding rather than assert what happened.
   */
  cancelledAfterDispatch: boolean;
}
