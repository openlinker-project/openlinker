/**
 * Shop Publish Master/Publisher Conflict Exception
 *
 * Raised when a publish targets a connection that holds both `ProductMaster`
 * and `ProductPublisher`. Connection create/update refuses that combination
 * (#4123), but a connection saved before the rule still carries it, and a
 * publish to it would be read back by its own catalog sync as a brand-new
 * master product. The remedy is on the connection, not on the request, so the
 * condition is permanent and must not be retried.
 *
 * @module libs/core/src/listings/domain/exceptions
 */

export class ShopPublishMasterPublisherConflictException extends Error {
  constructor(public readonly connectionId: string) {
    super(
      `Publishing to connection ${connectionId} is refused: it is both a ProductMaster and a ProductPublisher, ` +
        `so published products would be read back by its own catalog sync as new master products and ` +
        `create duplicates. Switch off ProductMaster on this connection to publish to it.`
    );
    this.name = 'ShopPublishMasterPublisherConflictException';
    Error.captureStackTrace(this, this.constructor);
  }
}
