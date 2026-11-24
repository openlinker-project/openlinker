/**
 * Regulatory Document Not Ready Error
 *
 * Thrown by a `RegulatoryDocumentReader` adapter when it CAN produce the
 * requested document kind but the record has not reached the point where it
 * exists - for a rendered document, before the authority has cleared it and
 * assigned its reference. The distinction from
 * {@link UnsupportedRegulatoryDocumentKindError} is the whole point: "never" and
 * "not yet" call for different words on a surface (#3620, #3548). Mapped to 409
 * at the interface layer, never to a failure. Country-agnostic (ADR-026): no
 * provider/regime vocabulary crosses this contract.
 *
 * @module libs/core/src/invoicing/domain/exceptions
 */
import type { RegulatoryDocumentKind } from '../types/invoicing.types';

export class RegulatoryDocumentNotReadyError extends Error {
  constructor(public readonly kind: RegulatoryDocumentKind) {
    super(
      `The regulatory document of kind '${kind}' is not available until the document is cleared`
    );
    this.name = 'RegulatoryDocumentNotReadyError';
    Error.captureStackTrace(this, this.constructor);
  }
}
