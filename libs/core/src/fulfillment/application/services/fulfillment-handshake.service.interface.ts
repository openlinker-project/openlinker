/**
 * Fulfilment Handshake Service — contract (#2399, `W3a-10`)
 *
 * The negotiation axis of a `FulfillmentWork`: offer it to its holder, record
 * the answer, and ask for it back. The EXECUTION axis (`FulfillmentWorkStatus`)
 * is untouched here — ADR-054's two axes are orthogonal, and a holder taking the
 * work says nothing about how far the picking has got.
 *
 * @module libs/core/src/fulfillment/application/services
 */
import type {
  DispatchFulfillmentWorkInput,
  FulfillmentHandshakeResult,
  RequestFulfillmentCancellationInput,
} from '../types/fulfillment-handshake.types';

export interface IFulfillmentHandshakeService {
  /**
   * Offer the work to its assigned holder under a retry-stable idempotency key.
   *
   * Claims the dispatch and mints the attempt in one conditional UPDATE, or
   * resumes an already-claimed attempt so a job retry re-mints the IDENTICAL
   * key. Never re-offers work a holder has already accepted.
   */
  dispatch(input: DispatchFulfillmentWorkInput): Promise<FulfillmentHandshakeResult>;

  /**
   * Ask an accepting holder to give the work back.
   *
   * The holder may refuse — that is a normal outcome, not an error, and is why
   * `cancellation_rejected` exists on the negotiation axis.
   */
  requestCancellation(
    input: RequestFulfillmentCancellationInput
  ): Promise<FulfillmentHandshakeResult>;
}
