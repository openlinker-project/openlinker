/**
 * Regulatory Status Reader Capability
 *
 * The READ half of the regulatory-clearance seam (#1143, ADR-026 §Decision.2,
 * ADR-002 sub-capability pattern). An optional sub-capability of `InvoicingPort`:
 * an invoicing adapter that can read back a tax authority's clearance status of
 * an already-issued document declares `implements RegulatoryStatusReader`.
 *
 * This is the role a provider that **transmits natively** exposes — e.g. Subiekt
 * sends the document to KSeF itself and OL only polls the resulting status
 * (#1121). Such adapters implement THIS capability and *not* `RegulatoryTransmitter`.
 * A provider OL submits to directly implements the full `RegulatoryTransmitter`
 * (which extends this), so it is a reader too.
 *
 * Call sites resolve the `Invoicing` capability adapter per-connection, then
 * narrow with `isRegulatoryStatusReader` before invoking — a provider without
 * regulatory read-back (the `not-applicable` default) simply doesn't implement it.
 *
 * Neutral-vocabulary litmus (ADR-026): no `nip`/`ksef`/`vat`/`jpk`/`faktura` here.
 *
 * @module libs/core/src/invoicing/domain/ports/capabilities
 * @see {@link RegulatoryTransmitter} for the submit+read superset capability
 */
import type { InvoiceRecord } from '../../entities/invoice-record.entity';
import type { RegulatoryClearanceResult } from '../../types/invoicing.types';
import type { InvoicingPort } from '../invoicing.port';

export interface RegulatoryStatusReader {
  /**
   * Read the current clearance status of an issued document from the
   * authority/provider. Returns the neutral status plus a `clearanceReference`
   * when the authority has assigned one (the KSeF number / SDI id are knowable
   * only by reading, after clearance). A business verdict — including `rejected`
   * — is returned as data; a transport/infrastructure failure throws for the
   * caller to handle and retry. `record` is the issued `InvoiceRecord` (carries
   * `clearanceReference` / `providerInvoiceId` / ids); the adapter picks what it
   * needs and performs no identifier mapping.
   */
  getClearanceStatus(record: InvoiceRecord): Promise<RegulatoryClearanceResult>;
}

export function isRegulatoryStatusReader(
  adapter: InvoicingPort,
): adapter is InvoicingPort & RegulatoryStatusReader {
  return typeof (adapter as Partial<RegulatoryStatusReader>).getClearanceStatus === 'function';
}
