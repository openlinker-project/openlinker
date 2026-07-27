/**
 * Offline Resubmitter Capability
 *
 * The degraded-mode retransmission seam (#1700, mini-epic #1585, ADR-035,
 * ADR-002 sub-capability pattern). An optional sub-capability of `InvoicingPort`:
 * an invoicing adapter whose regime permits issuing a document with legal effect
 * while the clearance authority is unreachable (a bounded "offline" grace window)
 * declares `implements OfflineResubmitter`. Such a document lands in the neutral
 * `pending-submission` state; a background sweep later calls `resubmit` to
 * retransmit it and advance it to `submitted` (or straight to a cleared/rejected
 * verdict for a synchronous regime).
 *
 * Call sites resolve the `Invoicing` capability adapter per-connection, then
 * narrow with `isOfflineResubmitter` before invoking — a provider without a
 * degraded-mode window simply doesn't implement it, and the sweep skips it.
 *
 * Neutral-vocabulary litmus (ADR-026): no `nip`/`ksef`/`vat`/`jpk`/`faktura` here.
 *
 * @module libs/core/src/invoicing/domain/ports/capabilities
 * @see {@link RegulatoryRecordLocator} for the crash-recovery authority lookup
 */
import type { InvoiceRecord } from '../../entities/invoice-record.entity';
import type { OfflineResubmitResult } from '../../types/invoicing.types';
import type { InvoicingPort } from '../invoicing.port';

export interface OfflineResubmitter {
  /**
   * Retransmit a document that was issued during a degraded-mode outage and is
   * currently in `pending-submission`. Returns the neutral status the resubmit
   * yielded plus the provider id / authority reference now known (an offline
   * issuance could not know the reference at issue time). A business refusal is
   * returned as `rejected` data; a transport/infra failure throws for the sweep
   * to retry. `record` is the issued `InvoiceRecord`; the adapter picks what it
   * needs and performs no identifier mapping.
   */
  resubmit(record: InvoiceRecord): Promise<OfflineResubmitResult>;
}

export function isOfflineResubmitter(
  adapter: InvoicingPort,
): adapter is InvoicingPort & OfflineResubmitter {
  return typeof (adapter as Partial<OfflineResubmitter>).resubmit === 'function';
}
