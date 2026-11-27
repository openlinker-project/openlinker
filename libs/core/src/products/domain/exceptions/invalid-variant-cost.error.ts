/**
 * Invalid Variant Cost Error
 *
 * Domain error: a cost write violated the indivisible (amount, currency) pair
 * or the value shape (#3588). Callers outside HTTP (jobs, MCP) are not covered
 * by the DTO, so the service enforces it too.
 *
 * @module libs/core/src/products/domain/exceptions
 */
export class InvalidVariantCostError extends Error {
  constructor(reason: string) {
    super(`Invalid variant cost: ${reason}`);
    this.name = 'InvalidVariantCostError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, InvalidVariantCostError);
    }
  }
}
