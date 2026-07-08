/**
 * ConnectionCredentialsRewriteException
 *
 * Thrown by `ConnectionCredentialsRewriterPort` implementations when the
 * submitted credentials payload cannot be rewritten (e.g. a referenced
 * sibling connection is the wrong kind, or a prerequisite field is missing).
 * `ConnectionService` catches this at the API boundary and maps it to
 * `BadRequestException`.
 *
 * Sibling of {@link InvalidCredentialsShapeException} — same rationale
 * (plugins don't depend on NestJS exception types for failure paths). Kept
 * as a distinct exception type rather than reusing
 * `InvalidCredentialsShapeException` because a rewrite failure is a
 * different concern from a shape failure: the payload's *shape* may be
 * perfectly valid (e.g. `{ reuseAllegroConnectionId: "..." }`) while the
 * *rewrite* still fails because the referenced id doesn't resolve to a
 * usable source.
 *
 * @module libs/core/src/integrations/domain/exceptions
 */
export class ConnectionCredentialsRewriteException extends Error {
  constructor(
    public readonly pluginName: string,
    detail: string
  ) {
    super(`Could not rewrite ${pluginName} credentials: ${detail}`);
    this.name = 'ConnectionCredentialsRewriteException';
    Error.captureStackTrace(this, this.constructor);
  }
}
