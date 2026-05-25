/**
 * Duplicate Routing Rule Exception
 *
 * Thrown by `FulfillmentRoutingService.replaceRules` when a replace batch
 * contains more than one rule for the same `sourceDeliveryMethodId`. Caught at
 * the service layer before any write so the `(source_connection_id,
 * source_delivery_method_id)` unique constraint never surfaces as a raw
 * `QueryFailedError`.
 *
 * @module libs/core/src/mappings/domain/exceptions
 */

export class DuplicateRoutingRuleException extends Error {
  constructor(public readonly sourceDeliveryMethodId: string) {
    super(
      `Duplicate fulfillment routing rule for delivery method '${sourceDeliveryMethodId}': a source delivery method may map to at most one processor`,
    );
    this.name = 'DuplicateRoutingRuleException';
    Error.captureStackTrace(this, this.constructor);
  }
}
