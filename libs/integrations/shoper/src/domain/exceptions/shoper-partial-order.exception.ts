/**
 * ShoperPartialOrderException
 *
 * Thrown when the order header exists on Shoper but a line could not be created
 * and the header could not be removed either. Shoper decrements stock as each
 * line is created, so the shop now holds an order that is incomplete and has
 * already moved stock.
 *
 * Retryable: a retry finds this header by its OpenLinker marker, sees it is
 * incomplete, deletes it (restoring the stock of its lines) and recreates the
 * order, so it cannot produce a second one. If the shop keeps refusing the
 * delete, the order can be removed by hand.
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
