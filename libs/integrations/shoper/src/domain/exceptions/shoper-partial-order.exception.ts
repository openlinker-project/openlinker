/**
 * ShoperPartialOrderException
 *
 * Thrown when the order header exists on Shoper but a line could not be created
 * and the header could not be removed either. Shoper decrements stock as each
 * line is created, so the shop now holds an order that is incomplete and has
 * already moved stock.
 *
 * Terminal on purpose: a retry would create a SECOND order next to this one.
 * An operator removes order `externalOrderId` in the shop (which restores the
 * stock of its lines) and re-runs the sync.
 *
 * @module libs/integrations/shoper/src/domain/exceptions
 */
export class ShoperPartialOrderException extends Error {
  constructor(
    readonly connectionId: string,
    readonly externalOrderId: string,
    readonly linesCreated: number,
    readonly linesTotal: number,
    readonly cause: unknown,
  ) {
    super(
      `Shoper order ${externalOrderId} on connection ${connectionId} is incomplete ` +
        `(${linesCreated}/${linesTotal} lines created) and could not be removed - delete it in the shop, ` +
        `then re-run the sync. Cause: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'ShoperPartialOrderException';
    Error.captureStackTrace(this, this.constructor);
  }
}
