/**
 * Content Field Not Found Exception
 *
 * Thrown by `ContentDraftService` operations that require an existing row
 * (e.g. publishing or discarding a draft on a row that never existed).
 *
 * @module libs/core/src/content/domain/exceptions
 */
export class ContentFieldNotFoundException extends Error {
  constructor(
    public readonly productId: string,
    public readonly connectionId: string | null,
    public readonly fieldKey: string,
  ) {
    super(
      `No content field row for productId=${productId} connectionId=${connectionId ?? 'master'} fieldKey=${fieldKey}.`,
    );
    this.name = 'ContentFieldNotFoundException';
    Error.captureStackTrace(this, this.constructor);
  }
}
