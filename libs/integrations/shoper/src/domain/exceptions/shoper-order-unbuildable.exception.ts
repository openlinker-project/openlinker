/**
 * ShoperOrderUnbuildableException
 *
 * Thrown BEFORE any write when an order cannot be expressed as a Shoper order:
 * a missing id Shoper requires (shipping, payment, status), a currency or tax
 * rate the shop does not have, an exclusive-priced line with no gross price, or
 * no address. Every cause is deterministic for the order and its connection
 * config, so a retry fails identically and the retry classifier treats it as
 * terminal. The message names what to fix.
 *
 * @module libs/integrations/shoper/src/domain/exceptions
 */
export class ShoperOrderUnbuildableException extends Error {
  constructor(
    readonly connectionId: string,
    readonly reason: string,
  ) {
    super(`Cannot create the order on Shoper connection ${connectionId}: ${reason}`);
    this.name = 'ShoperOrderUnbuildableException';
    Error.captureStackTrace(this, this.constructor);
  }
}
