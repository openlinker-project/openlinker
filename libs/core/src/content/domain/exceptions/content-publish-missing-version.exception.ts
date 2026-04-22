/**
 * Content Publish Missing Version Exception
 *
 * Thrown by `IntegrationsContentPublisher` when the underlying ProductMaster
 * adapter returns a successful update response but does not include an
 * `updatedAt` field that can be recorded as `baseVersion`. Without a real
 * platform-derived version marker, the next inbound reconcile would compare
 * the platform's actual `updatedAt` against a synthetic local timestamp and
 * spuriously flag a conflict — corrupting the conflict-detection invariant.
 *
 * Adapters implementing `ProductMasterPort` MUST return a `Product` with
 * `updatedAt` populated after a successful `updateProduct` call.
 *
 * @module libs/core/src/content/domain/exceptions
 */
export class ContentPublishMissingVersionException extends Error {
  constructor(
    public readonly productId: string,
    public readonly fieldKey: string,
  ) {
    super(
      `ProductMaster adapter returned no updatedAt after publishing content (productId=${productId} fieldKey=${fieldKey}). The adapter must populate Product.updatedAt so a baseVersion can be recorded; otherwise the next reconcile would falsely report a conflict.`,
    );
    this.name = 'ContentPublishMissingVersionException';
    Error.captureStackTrace(this, this.constructor);
  }
}
