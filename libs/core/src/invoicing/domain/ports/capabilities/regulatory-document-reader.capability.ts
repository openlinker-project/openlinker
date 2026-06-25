/**
 * Regulatory Document Reader Capability
 *
 * Optional ADR-002 sub-capability of `InvoicingPort` — adapters that can retrieve
 * the tax authority's confirmation document for a cleared fiscal document declare
 * `implements InvoicingPort, RegulatoryDocumentReader`. Reading the confirmation
 * document is a distinct act from issuance and clearance status, so it is composed
 * onto the base port rather than baked into it (the same shape as
 * `RegulatoryTransmitter`): a provider without a downloadable confirmation simply
 * doesn't implement the guard and the read path is skipped (clean 409 upstream).
 *
 * Country-agnostic (ADR-026): the method takes the neutral `InvoiceRecord` (the
 * adapter resolves its own provider references from it) and returns a neutral
 * {@link RegulatoryDocument} blob — raw bytes plus the provider-reported content
 * type. No country/regime tax vocabulary crosses this contract; the wire details
 * live behind the provider adapter.
 *
 * See `./regulatory-transmitter.capability.ts` for the sibling clearance
 * sub-capability this mirrors.
 *
 * @module libs/core/src/invoicing/domain/ports/capabilities
 */
import type { InvoiceRecord } from '../../entities/invoice-record.entity';
import type { InvoicingPort } from '../invoicing.port';

/**
 * Neutral confirmation document for a cleared fiscal document (the authority's
 * official receipt — e.g. an UPO on the PL regime). `content` is the raw document
 * bytes; `contentType` is the provider-reported MIME type (`application/pdf`,
 * `application/xml`, …) the caller streams back verbatim. Opaque to core.
 */
export interface RegulatoryDocument {
  content: Uint8Array;
  contentType: string;
}

export interface RegulatoryDocumentReader {
  /**
   * Retrieve the authority's confirmation document for an already-cleared record
   * (e.g. the UPO on the PL/KSeF regime). The adapter resolves its provider
   * references from the record; callers gate on the record being cleared before
   * invoking (a not-yet-available document is a caller-side 409, not a thrown
   * adapter error).
   */
  getRegulatoryDocument(record: InvoiceRecord): Promise<RegulatoryDocument>;
}

export function isRegulatoryDocumentReader(
  adapter: InvoicingPort,
): adapter is InvoicingPort & RegulatoryDocumentReader {
  const candidate = adapter as Partial<RegulatoryDocumentReader>;
  return typeof candidate.getRegulatoryDocument === 'function';
}
