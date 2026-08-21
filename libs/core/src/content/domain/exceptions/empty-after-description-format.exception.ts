/**
 * Empty After Description Format Exception
 *
 * Thrown by the channel publisher when the authored description survives the
 * destination's declared grammar as nothing at all (ADR-046). Every tag AND
 * every character of text was rejected - not merely reshaped.
 *
 * It is an exception rather than a silent skip because the alternative is worse
 * than a no-op: sending the emptied field would call the marketplace once per
 * offer, change nothing, and still return a fresh `baseVersion`, which marks the
 * draft published and clears the conflict flag on a publish that never happened.
 * A precondition failure the operator can act on - surfaced as HTTP 422.
 *
 * @module libs/core/src/content/domain/exceptions
 */
export class EmptyAfterDescriptionFormatException extends Error {
  public readonly productId: string;
  public readonly connectionId: string;

  constructor(productId: string, connectionId: string) {
    super(
      `The description for product ${productId} survives connection ${connectionId}'s declared format as empty. Nothing would reach the channel; rewrite it using the formatting the destination accepts.`,
    );
    this.name = 'EmptyAfterDescriptionFormatException';
    this.productId = productId;
    this.connectionId = connectionId;
    Error.captureStackTrace(this, this.constructor);
  }
}
