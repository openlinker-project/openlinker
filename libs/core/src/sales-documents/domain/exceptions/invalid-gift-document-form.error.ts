/**
 * Raised when a gift form outside the four offered choices is saved as the
 * OpenLinker-wide default (#3941). `internal-record` is deliberately not one.
 *
 * @module libs/core/src/sales-documents/domain/exceptions
 */
export class InvalidGiftDocumentFormError extends Error {
  constructor(readonly received: string) {
    super(`Gift form "${received}" is not one of the offered choices`);
    this.name = 'InvalidGiftDocumentFormError';
  }
}
