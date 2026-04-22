/**
 * Channel Content Publish Not Supported Exception
 *
 * Thrown by the MVP `IntegrationsContentPublisher` when a publish is requested
 * for a channel-scoped row (`connectionId !== null`). The channel publish
 * path requires offer discovery from `(productId, connectionId)` and
 * marketplace `updateOfferFields` wiring — both deferred to follow-up
 * issues #339 (editor UI) and #342 (AI suggestion flow). This PR ships the
 * surface; the wire is short and intentional.
 *
 * @module libs/core/src/content/domain/exceptions
 */
export class ChannelContentPublishNotSupportedException extends Error {
  constructor(
    public readonly productId: string,
    public readonly connectionId: string,
    public readonly fieldKey: string,
  ) {
    super(
      `Channel-scoped content publish is not yet wired (productId=${productId} connectionId=${connectionId} fieldKey=${fieldKey}). Tracked in #339 / #342.`,
    );
    this.name = 'ChannelContentPublishNotSupportedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
