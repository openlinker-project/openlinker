/**
 * WooCommerce Order Create Ambiguous Exception
 *
 * Thrown when `POST /orders` answers 2xx with no `id` in the body (#3469).
 * WooCommerce may have created the order regardless — the field is simply
 * missing from the response we read — so the job runner must NOT retry: a
 * blind retry re-POSTs the same non-idempotent create and books the order a
 * second time. Distinct from `WooCommerceResourceNotFoundException`, which
 * means "this resource genuinely does not exist" — here the create may have
 * succeeded and the ambiguity itself is the failure.
 *
 * @module libs/integrations/woocommerce/src/domain/exceptions
 */
export class WooCommerceOrderCreateAmbiguousException extends Error {
  constructor(readonly connectionId: string) {
    super(
      `WooCommerce order create returned a 2xx response with no order id — the order may ` +
        `already exist on the shop. This will not be retried automatically; use the ` +
        `destination Retry action after verifying whether the order was created.`,
    );
    this.name = 'WooCommerceOrderCreateAmbiguousException';
    Error.captureStackTrace(this, this.constructor);
  }
}
