/**
 * Order Note Not Found Error (#3531)
 *
 * Raised both for a genuinely missing note id and for a permission refusal
 * (a non-author, non-admin editing/deleting a note) — the caller maps the
 * latter to 403 by re-checking role, this error alone only ever means "no
 * such note, or you may not act on it".
 *
 * @module libs/core/src/orders/domain/exceptions
 */
export class OrderNoteNotFoundError extends Error {
  constructor(public readonly noteId: string) {
    super(`Order note not found: ${noteId}`);
    this.name = 'OrderNoteNotFoundError';
    Error.captureStackTrace(this, this.constructor);
  }
}
