/**
 * Raised when a gift form outside the offered choices is saved as the
 * OpenLinker-wide default (#3941), or a `custom-price` arrives without a valid
 * amount. `internal-record` is deliberately not a choice.
 *
 * @module libs/core/src/sales-documents/domain/exceptions
 */
export class InvalidGiftDocumentFormError extends Error {
  constructor(
    readonly received: string,
    detail?: string,
  ) {
    super(detail ?? `Gift form "${received}" is not one of the offered choices`);
    this.name = 'InvalidGiftDocumentFormError';
  }
}
