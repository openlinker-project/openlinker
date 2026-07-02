/**
 * Source Document Immutable Error
 *
 * Thrown by the repository's `updateOutcome` when a patch attempts to overwrite
 * an already-persisted `sourceDocument` snapshot. The source document is
 * write-once (set exactly once at issuance) — a second write would silently
 * replace the persisted machine-readable original.
 *
 * @module libs/core/src/invoicing/domain/exceptions
 */
export class SourceDocumentImmutableError extends Error {
  constructor(id: string) {
    super(`sourceDocument is write-once and cannot overwrite an existing snapshot for invoice record: ${id}`);
    this.name = 'SourceDocumentImmutableError';
    Error.captureStackTrace(this, this.constructor);
  }
}
