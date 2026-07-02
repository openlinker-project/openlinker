/**
 * Unsupported Regulatory Document Kind Error
 *
 * Thrown by a `RegulatoryDocumentReader` adapter when it cannot produce a document
 * of the requested neutral `RegulatoryDocumentKind` (e.g. a provider with no
 * server-side human-readable rendering). A soft, expected condition the interface
 * layer maps to 409 — not a hard provider failure. Country-agnostic (ADR-026): no
 * provider/regime vocabulary crosses this contract.
 *
 * @module libs/core/src/invoicing/domain/exceptions
 */
import type { RegulatoryDocumentKind } from '../types/invoicing.types';

export class UnsupportedRegulatoryDocumentKindError extends Error {
  constructor(public readonly kind: RegulatoryDocumentKind) {
    super(`Provider cannot produce a regulatory document of kind: ${kind}`);
    this.name = 'UnsupportedRegulatoryDocumentKindError';
    Error.captureStackTrace(this, this.constructor);
  }
}
