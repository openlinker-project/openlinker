/**
 * Regulatory Record Locator Capability
 *
 * The last-resort crash-recovery lookup seam (#1700, mini-epic #1585, ADR-035,
 * ADR-002 sub-capability pattern). An optional sub-capability of `InvoicingPort`:
 * an invoicing adapter whose authority can be queried by business coordinates
 * (seller identifier, document number, issue-date window) declares `implements
 * RegulatoryRecordLocator`.
 *
 * It answers the question OL cannot answer from its own state after a process
 * died mid-submit: did the authority actually receive the document? The recovery
 * sweep resolves the `Invoicing` capability adapter per-connection, narrows with
 * `isRegulatoryRecordLocator`, and calls `locateByQuery`; a provider that cannot
 * be queried this way simply doesn't implement it, and the sweep degrades to its
 * other recovery strategies.
 *
 * Neutral-vocabulary litmus (ADR-026): no `nip`/`ksef`/`vat`/`jpk`/`faktura` here.
 *
 * @module libs/core/src/invoicing/domain/ports/capabilities
 * @see {@link OfflineResubmitter} for the degraded-mode retransmission seam
 */
import type {
  RegulatoryLocateCriteria,
  RegulatoryLocateResult,
} from '../../types/invoicing.types';
import type { InvoicingPort } from '../invoicing.port';

export interface RegulatoryRecordLocator {
  /**
   * Look the document up on the authority's side by business coordinates.
   * Returns the neutral status + provider id + authority reference when the
   * authority holds a match, or `null` when it does not (the caller then treats
   * the interrupted attempt as never having landed and re-issues). A
   * transport/infra failure throws for the caller to retry.
   */
  locateByQuery(criteria: RegulatoryLocateCriteria): Promise<RegulatoryLocateResult | null>;
}

export function isRegulatoryRecordLocator(
  adapter: InvoicingPort,
): adapter is InvoicingPort & RegulatoryRecordLocator {
  return typeof (adapter as Partial<RegulatoryRecordLocator>).locateByQuery === 'function';
}
