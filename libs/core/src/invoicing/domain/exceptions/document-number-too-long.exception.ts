/**
 * Document Number Too Long Exception
 *
 * Domain error raised when a rendered numbering-series document number exceeds
 * the provider's maximum accepted length (#11) — e.g. KSeF's FA(3) `P_2` limit
 * of 256 characters. Caught in core BEFORE the provider boundary (during
 * allocation) so an over-length number is rejected in OpenLinker with an
 * actionable message rather than failing opaquely at the provider. Neutral
 * vocabulary only: a document number and a length limit are neutral concepts.
 *
 * @module libs/core/src/invoicing/domain/exceptions
 */
export class DocumentNumberTooLongException extends Error {
  constructor(
    public readonly actualLength: number,
    public readonly maxLength: number,
  ) {
    super(
      `Rendered document number is ${actualLength} characters, exceeding the provider ` +
        `maximum of ${maxLength}. Shorten the numbering pattern (fewer literal characters ` +
        'or a smaller sequence padding).',
    );
    this.name = 'DocumentNumberTooLongException';
    Error.captureStackTrace(this, this.constructor);
  }
}
