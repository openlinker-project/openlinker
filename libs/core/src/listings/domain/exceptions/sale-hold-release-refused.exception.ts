/**
 * Sale Hold Release Refused Exception (#3962)
 *
 * Thrown when an operator asks to put a listing back on sale while the
 * product or variant it sells is still deleted at the master. Putting it back
 * would sell something that does not exist, so nothing is released. The
 * controller maps it to HTTP 409.
 *
 * @module libs/core/src/listings/domain/exceptions
 */

export class SaleHoldReleaseRefusedException extends Error {
  constructor(
    public readonly productId: string,
    public readonly holdIds: readonly string[],
  ) {
    super(
      `Cannot put product ${productId} back on sale: it is still deleted at the source (holds: ${holdIds.join(', ')})`,
    );
    this.name = 'SaleHoldReleaseRefusedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
