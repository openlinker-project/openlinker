/**
 * Cursor Rewind Refused Error (#4023)
 *
 * A refused cursor rewind, with a closed reason so the HTTP layer maps each to
 * the right status without parsing a message.
 *
 * @module libs/core/src/sync/domain/exceptions
 */
export const CursorRewindRefusalValues = [
  'cursor-not-found',
  'not-rewindable',
  'target-mismatch',
  'pass-not-open',
  'run-in-progress',
] as const;
export type CursorRewindRefusal = (typeof CursorRewindRefusalValues)[number];

export class CursorRewindRefusedError extends Error {
  constructor(
    public readonly reason: CursorRewindRefusal,
    public readonly cursorKey: string,
    message: string
  ) {
    super(message);
    this.name = 'CursorRewindRefusedError';
    Error.captureStackTrace(this, this.constructor);
  }
}
