/**
 * Regulatory Status Reader Capability
 *
 * Optional READ-ONLY sub-capability of `InvoicingPort` (ADR-002) — adapters that
 * can read the authoritative provider-/CTC-side regulatory status of a
 * previously-issued document declare `implements RegulatoryStatusReader`. Used by
 * the KSeF regulatory-status reconciliation job (#1121) to refresh
 * `InvoiceRecord.regulatoryStatus` / `clearanceReference` for issued records whose
 * regulatory status is still non-terminal.
 *
 * READ-ONLY by design: it reads status back, it does NOT submit/transmit to the
 * authority. For Subiekt the bridge only reads (Subiekt transmits to KSeF
 * natively); the submit side is the still-future, separate `RegulatoryTransmitter`
 * sub-capability. Detected at runtime by the {@link isRegulatoryStatusReader}
 * type guard — NOT advertised as a capability string in `supportedCapabilities`
 * (same idiom as `OfferStatusReader` under `OfferManager`).
 *
 * Returns the raw neutral observation only; mapping a regime's native state onto
 * the neutral `RegulatoryStatus` lifecycle is owned by the adapter. See
 * `offer-status-reader.capability.ts` for the shared naming convention.
 *
 * @module libs/core/src/invoicing/domain/ports/capabilities
 */
import type { InvoiceRecord } from '../../entities/invoice-record.entity';
import type { RegulatoryStatusReadResult } from '../../types/regulatory-status-read.types';
import type { InvoicingPort } from '../invoicing.port';

export interface RegulatoryStatusReader {
  /**
   * Read the authoritative regulatory status for an already-issued record.
   * The adapter returns a neutral observation already mapped onto
   * {@link RegulatoryStatusReadResult}.
   */
  readRegulatoryStatus(record: InvoiceRecord): Promise<RegulatoryStatusReadResult>;
}

export function isRegulatoryStatusReader(
  adapter: InvoicingPort,
): adapter is InvoicingPort & RegulatoryStatusReader {
  return (
    typeof (adapter as Partial<RegulatoryStatusReader>).readRegulatoryStatus === 'function'
  );
}
