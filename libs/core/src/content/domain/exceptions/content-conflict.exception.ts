/**
 * Content Conflict Exception
 *
 * Thrown by `ContentDraftService.publishDraft` when the row carries
 * `hasConflict=true`. Signals that the inbound reconcile observed an
 * external divergence while the user's draft was pending — the draft must
 * be re-saved (acknowledging the new base) before publish is allowed.
 *
 * @module libs/core/src/content/domain/exceptions
 */
export class ContentConflictException extends Error {
  constructor(
    public readonly productId: string,
    public readonly connectionId: string | null,
    public readonly fieldKey: string,
  ) {
    super(
      `Content conflict for productId=${productId} connectionId=${connectionId ?? 'master'} fieldKey=${fieldKey}; resave the draft to acknowledge the divergence before publishing.`,
    );
    this.name = 'ContentConflictException';
    Error.captureStackTrace(this, this.constructor);
  }
}
