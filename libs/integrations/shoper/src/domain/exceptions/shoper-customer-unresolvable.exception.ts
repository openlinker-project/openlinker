/**
 * ShoperCustomerUnresolvableException
 *
 * Thrown when no Shoper user can be resolved or created for an order. Shoper
 * rejects `user_id = 0` on `POST /orders` and does not provision a guest
 * (SPIKE-3638), so - unlike WooCommerce, which falls back to a guest order -
 * there is no order to place without a user, and the only thing that identifies
 * one is the buyer's email.
 *
 * Deterministic for the order (a retry sees the same missing email), so the
 * retry classifier treats it as terminal. Typical causes: a source that reports
 * no buyer email, or `OL_STORE_PII=false`, which stores only an email hash.
 *
 * @module libs/integrations/shoper/src/domain/exceptions
 */
export class ShoperCustomerUnresolvableException extends Error {
  constructor(
    readonly connectionId: string,
    readonly reason: string,
  ) {
    super(
      `Cannot resolve a Shoper user for the order on connection ${connectionId}: ${reason}. ` +
        'Shoper does not accept guest orders, so the order needs a buyer email.',
    );
    this.name = 'ShoperCustomerUnresolvableException';
    Error.captureStackTrace(this, this.constructor);
  }
}
