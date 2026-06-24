/**
 * Regulatory Transmitter Capability
 *
 * The full SUBMIT + READ regulatory-clearance seam (#1143, ADR-026 §Decision.2,
 * ADR-002 sub-capability pattern). An optional sub-capability of `InvoicingPort`:
 * an invoicing adapter that **OL itself transmits through** to a tax authority
 * (a future KSeF-direct adapter; IT SDI, ES SII…) declares `implements
 * RegulatoryTransmitter`. The adapter maps the authority's regime states onto the
 * neutral `RegulatoryStatus` lifecycle and returns a `clearanceReference`.
 *
 * **Why this `extends RegulatoryStatusReader`** — this is the FIRST capability
 * interface in the codebase to extend another (OL's idiom is otherwise flat,
 * independent capabilities composed via `implements A, B`). It is justified, not
 * accidental: a transmitter is *necessarily* also a reader — the authority
 * reference (KSeF number / SDI id) is assigned only after submission and is
 * knowable only by reading status, so submit logically entails read. That is a
 * genuine is-a (LSP subset), unlike OL's orthogonal `*Reader`/`*Updater` pairs
 * (e.g. `FulfillmentStatusReader` vs `OrderFulfillmentUpdater`) which share no
 * subset relationship. **Do NOT cargo-cult `extends` for orthogonal capabilities**
 * — keep those flat and independent. The `extends` also lets the #1121
 * reconciliation poller narrow every transmitter with the one
 * `isRegulatoryStatusReader` guard.
 *
 * Neutral-vocabulary litmus (ADR-026): no `nip`/`ksef`/`vat`/`jpk`/`faktura` here.
 *
 * @module libs/core/src/invoicing/domain/ports/capabilities
 * @see {@link RegulatoryStatusReader} for the read-only half (Subiekt-style providers)
 */
import type { InvoiceRecord } from '../../entities/invoice-record.entity';
import type { RegulatoryClearanceResult } from '../../types/invoicing.types';
import type { InvoicingPort } from '../invoicing.port';
import type { RegulatoryStatusReader } from './regulatory-status-reader.capability';

export interface RegulatoryTransmitter extends RegulatoryStatusReader {
  /**
   * Transmit an issued document to the tax authority for clearance. Returns the
   * neutral status the submit yielded: a *synchronous* regime (Spain SII /
   * Veri*factu) reports the final status here; an *asynchronous* clearance regime
   * (KSeF, SDI) returns `submitted` and the caller later polls `getClearanceStatus`.
   * A business refusal is returned as `rejected` data; a transport/infrastructure
   * failure throws. Should be a no-op returning current status when re-submitted
   * for an already-cleared document where the regime allows (exactly-once
   * *issuance* is gated upstream on the command — ADR-026). `record` is the issued
   * `InvoiceRecord`; the adapter performs no identifier mapping.
   */
  submitForClearance(record: InvoiceRecord): Promise<RegulatoryClearanceResult>;
}

export function isRegulatoryTransmitter(
  adapter: InvoicingPort,
): adapter is InvoicingPort & RegulatoryTransmitter {
  // Multi-method capability: the narrowed type promises BOTH the transmit method
  // and the inherited read method, so the runtime guard must verify both (unlike
  // the single-method capability guards elsewhere). Otherwise an adapter exposing
  // only `submitForClearance` would narrow to a contract it can't honour and the
  // #1121 poller's `getClearanceStatus` call would hit `undefined`.
  const partial = adapter as Partial<RegulatoryTransmitter>;
  return (
    typeof partial.submitForClearance === 'function' &&
    typeof partial.getClearanceStatus === 'function'
  );
}
