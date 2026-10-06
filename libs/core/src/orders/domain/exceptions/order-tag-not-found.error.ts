/**
 * Order Tag Not Found Error (#3532)
 *
 * @module libs/core/src/orders/domain/exceptions
 */
export class OrderTagNotFoundError extends Error {
  constructor(public readonly tagId: string) {
    super(`Order tag not found: ${tagId}`);
    this.name = 'OrderTagNotFoundError';
    Error.captureStackTrace(this, this.constructor);
  }
}
