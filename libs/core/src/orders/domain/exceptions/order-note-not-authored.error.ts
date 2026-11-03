/**
 * Order Note Not Authored Error (#3531, D33)
 *
 * Raised when a caller who is neither the note's author nor an admin tries to
 * edit or delete it. Kept distinct from `OrderNoteNotFoundError` (a genuinely
 * missing id) so the controller can answer 403 rather than 404 — unlike the
 * column-preset case, WHICH notes exist on an order is not itself sensitive,
 * so there is nothing to protect by blurring the two.
 *
 * @module libs/core/src/orders/domain/exceptions
 */
export class OrderNoteNotAuthoredError extends Error {
  constructor(public readonly noteId: string) {
    super(`Order note ${noteId} is not owned by the caller`);
    this.name = 'OrderNoteNotAuthoredError';
    Error.captureStackTrace(this, this.constructor);
  }
}
