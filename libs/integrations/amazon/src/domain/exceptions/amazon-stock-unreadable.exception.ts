/**
 * Amazon Stock Unreadable Exception (#4183)
 *
 * A listing names the seller channel but carries no quantity OpenLinker can
 * read. Never read as 0: a master sync publishing a missing value as zero
 * would pause a live offer on every channel (#1689). Not terminal, so the job
 * retries and the next read can succeed.
 *
 * @module libs/integrations/amazon/src/domain/exceptions
 */
export class AmazonStockUnreadableException extends Error {
  constructor(
    public readonly sku: string,
    public readonly connectionId: string,
  ) {
    super(`Amazon listing ${sku} reports no readable seller-fulfilled quantity (connection: ${connectionId})`);
    this.name = 'AmazonStockUnreadableException';
    Error.captureStackTrace(this, this.constructor);
  }
}
