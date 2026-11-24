/**
 * Stored-document hash (#3620)
 *
 * The one rule for hashing a persisted {@link StoredDocument}: Base64URL of the
 * SHA-256 over its exact decoded bytes. It sits beside the type it hashes
 * (the `*.types.ts` pure-rule exception in `engineering-standards.md`): no I/O,
 * no injected dependency, a function of its input alone.
 *
 * Neutral (ADR-026): it hashes opaque bytes and names no regime. The provider
 * that needs the value in a link (the KSeF verification link) reads it from
 * `InvoiceRecord.sourceDocumentHash`; it is never recomputed from re-serialised
 * content, only from the stored bytes themselves.
 *
 * @module libs/core/src/invoicing/domain/types
 */
import { createHash } from 'crypto';
import type { StoredDocument } from './invoicing.types';

export const computeStoredDocumentHash = (document: StoredDocument): string =>
  createHash('sha256').update(Buffer.from(document.contentBase64, 'base64')).digest('base64url');
