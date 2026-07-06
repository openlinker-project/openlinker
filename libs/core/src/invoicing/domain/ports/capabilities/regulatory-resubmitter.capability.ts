/**
 * Regulatory Resubmitter Capability
 *
 * Optional sub-capability of `InvoicingPort` (#1356): an invoicing adapter that
 * can re-trigger transmission of an ALREADY-ISSUED document to the tax authority
 * declares `implements RegulatoryResubmitter`. It backs the operator "resend"
 * action for a document whose clearance ended in `rejected` — the adapter kicks
 * a fresh submission of the SAME provider document and returns the neutral
 * clearance outcome the resubmit yielded.
 *
 * Distinct from {@link RegulatoryTransmitter} on purpose: a transmitter is a
 * provider OL itself holds the authority session for (OL builds + submits the
 * document). A resubmitter is a NATIVELY-transmitting provider (e.g. inFakt,
 * which owns its own KSeF session and builds the fiscal XML) that nonetheless
 * needs an explicit submission kick from OL — re-sending is that kick, not OL
 * driving the session. Kept FLAT and independent (it does not `extends`
 * `RegulatoryStatusReader`): the resubmit returns the post-submit status as data
 * on its own, and adapters that also poll status implement
 * `RegulatoryStatusReader` separately — do not cargo-cult `extends` for
 * orthogonal capabilities.
 *
 * Call sites resolve the `Invoicing` capability adapter per-connection, then
 * narrow with `isRegulatoryResubmitter` before invoking — a provider that has no
 * resend concept simply doesn't implement it (the HTTP layer degrades to 501).
 *
 * Neutral-vocabulary litmus (ADR-026): the CONTRACT SURFACE — interface name,
 * method name, parameter/return types — carries no `nip`/`ksef`/`vat`/`jpk`/
 * `faktura` vocabulary. The prose above names inFakt/KSeF only as illustrative
 * examples of a natively-transmitting provider; those are documentation, not part
 * of the type surface a sibling context binds to.
 *
 * @module libs/core/src/invoicing/domain/ports/capabilities
 * @see {@link RegulatoryStatusReader} for the read-only clearance-poll half
 * @see {@link RegulatoryTransmitter} for the OL-holds-the-session submit half
 */
import type { InvoiceRecord } from '../../entities/invoice-record.entity';
import type { RegulatoryClearanceResult } from '../../types/invoicing.types';
import type { InvoicingPort } from '../invoicing.port';

export interface RegulatoryResubmitter {
  /**
   * Re-trigger transmission of an already-issued document to the authority and
   * return the neutral clearance outcome the resubmit yielded. Operates on the
   * SAME provider document referenced by `record` (never re-creating it), so it
   * cannot double-issue a fiscal document. A business verdict (incl. a repeat
   * `rejected`) is returned as data; a transport/infrastructure failure throws
   * for the caller to map. `record` is the issued `InvoiceRecord` — the adapter
   * reads what it needs (`providerInvoiceId`, …) and performs no identifier
   * mapping.
   */
  resubmitForClearance(record: InvoiceRecord): Promise<RegulatoryClearanceResult>;
}

export function isRegulatoryResubmitter(
  adapter: InvoicingPort,
): adapter is InvoicingPort & RegulatoryResubmitter {
  return typeof (adapter as Partial<RegulatoryResubmitter>).resubmitForClearance === 'function';
}
