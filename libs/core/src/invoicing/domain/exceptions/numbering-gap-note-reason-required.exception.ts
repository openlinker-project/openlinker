/**
 * Numbering Gap-Note Reason Required Exception
 *
 * Domain error raised when a gap explanation is recorded with an empty/blank
 * `reason` (#8). A gap note exists to carry the operator's written explanation,
 * so a blank reason is a domain-invalid input the core rejects.
 *
 * @module libs/core/src/invoicing/domain/exceptions
 */
export class NumberingGapNoteReasonRequiredException extends Error {
  constructor(seriesId: string, seq: number) {
    super(`A non-empty reason is required to explain gap seq ${seq} of series ${seriesId}`);
    this.name = 'NumberingGapNoteReasonRequiredException';
    Error.captureStackTrace(this, this.constructor);
  }
}
