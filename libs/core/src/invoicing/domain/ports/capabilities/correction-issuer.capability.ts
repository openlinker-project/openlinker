/**
 * Correction Issuer Capability
 *
 * Issue half of the correction seam (#1229, ADR-026, ADR-002 sub-capability
 * pattern). An optional sub-capability of `InvoicingPort`: an invoicing adapter
 * that can issue a correction (price/quantity change) of an already-issued
 * document declares `implements InvoicingPort, CorrectionIssuer`.
 *
 * The neutral `IssueCorrectionCommand` carries only what core knows — the order,
 * the corrected original's provider id, the per-line new quantity / gross unit
 * price, and an optional reason. The provider-native correction-document mechanic
 * (faktura korygująca, credit note, …) lives entirely behind the adapter.
 *
 * Call sites resolve the `Invoicing` capability adapter per-connection, then
 * narrow with `isCorrectionIssuer` before invoking — a provider without
 * correction support simply doesn't implement it.
 *
 * Neutral-vocabulary litmus (ADR-026): no `nip`/`ksef`/`vat`/`jpk`/`faktura` here.
 *
 * @module libs/core/src/invoicing/domain/ports/capabilities
 */
import type { IssueCorrectionCommand, IssueInvoiceResult } from '../../types/invoicing.types';
import type { InvoicingPort } from '../invoicing.port';

export interface CorrectionIssuer {
  /**
   * Issue a correction of an already-issued document. Returns the same
   * {@link IssueInvoiceResult} shape `issueInvoice` does (transient issued
   * `record` the core service persists, plus the optional `seller`/
   * `sourceDocument` an adapter that builds its own machine-readable document
   * — e.g. KSeF's FA(3) XML — surfaces so `GET .../document?kind=source`
   * works for corrections too, #1229 follow-up). A business rejection throws
   * a terminal error; a transport/infrastructure failure throws for the
   * caller to retry. Performs no identifier mapping.
   */
  issueCorrection(cmd: IssueCorrectionCommand): Promise<IssueInvoiceResult>;
}

export function isCorrectionIssuer(
  adapter: InvoicingPort,
): adapter is InvoicingPort & CorrectionIssuer {
  return typeof (adapter as Partial<CorrectionIssuer>).issueCorrection === 'function';
}
