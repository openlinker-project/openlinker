/**
 * Regulatory Transmitter Capability
 *
 * Optional ADR-002 sub-capability of `InvoicingPort` — adapters that transmit an
 * issued fiscal document to a tax authority for clearance declare
 * `implements InvoicingPort, RegulatoryTransmitter`. Issuance and regulatory
 * clearance are distinct acts with different lifecycles, so clearance is composed
 * onto the base port rather than baked into it (ADR-026 step 9 / 49): a
 * non-clearance provider simply doesn't implement the guard and the clearance
 * block is skipped.
 *
 * Country-agnostic: results carry only the neutral CTC `RegulatoryStatus`
 * lifecycle plus an opaque `clearanceReference` the authority assigns and the
 * adapter interprets — core carries it inert. No country/regime tax vocabulary
 * crosses this contract; that lives behind the provider adapter.
 *
 * See `../../../listings/domain/ports/capabilities/offer-status-reader.capability.ts`
 * for the shared naming + guard convention this mirrors.
 *
 * @module libs/core/src/invoicing/domain/ports/capabilities
 */
import type { InvoiceRecord } from '../../entities/invoice-record.entity';
import type { RegulatoryStatus } from '../../types/invoicing.types';
import type { InvoicingPort } from '../invoicing.port';

/**
 * Neutral outcome of a clearance operation — shared by both
 * {@link RegulatoryTransmitter.submitForClearance} (immediate result) and
 * {@link RegulatoryTransmitter.getClearanceStatus} (later status read).
 * `clearanceReference` is the authority-assigned identifier, opaque to core.
 */
export interface ClearanceResult {
  regulatoryStatus: RegulatoryStatus;
  clearanceReference: string | null;
}

/** Status read of a previously-submitted document; same neutral shape as the submit result. */
export type ClearanceStatus = ClearanceResult;

export interface RegulatoryTransmitter {
  /** Submit an issued document to the tax authority for clearance. */
  submitForClearance(record: InvoiceRecord): Promise<ClearanceResult>;

  /**
   * Read the current clearance status — by the authority-assigned reference, or
   * by the issued record when the reference is not yet to hand.
   */
  getClearanceStatus(reference: string | InvoiceRecord): Promise<ClearanceStatus>;
}

export function isRegulatoryTransmitter(
  adapter: InvoicingPort,
): adapter is InvoicingPort & RegulatoryTransmitter {
  const candidate = adapter as Partial<RegulatoryTransmitter>;
  return (
    typeof candidate.submitForClearance === 'function' &&
    typeof candidate.getClearanceStatus === 'function'
  );
}
