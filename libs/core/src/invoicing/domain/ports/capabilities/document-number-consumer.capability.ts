/**
 * Document Number Consumer Capability
 *
 * Optional sub-capability of `InvoicingPort` (#1575): an invoicing adapter that
 * relies on OpenLinker to supply the legal, sequential document number for each
 * issued document declares `implements DocumentNumberConsumer`. When the resolved
 * adapter passes `isDocumentNumberConsumer`, the core `InvoiceService` allocates a
 * number from the connection's numbering series and sets
 * `IssueInvoiceCommand.documentNumber`; the adapter consumes it verbatim (KSeF:
 * FA(3) `P_2`). Providers that number documents themselves (inFakt/Subiekt) do
 * NOT implement it and keep their own provider-assigned number — numbering is
 * opt-in per adapter, never forced onto a provider with its own series.
 *
 * Neutral-vocabulary litmus (ADR-026): no provider/country vocabulary here — a
 * document number is a neutral commercial concept.
 *
 * MARKER shape: the capability carries no methods, so it cannot be duck-typed by
 * method presence like the sibling capabilities. It instead exposes a single
 * `readonly` discriminant (`consumesDocumentNumber: true`) that the guard reads —
 * the minimum a runtime type-guard needs to distinguish a marker capability.
 *
 * @module libs/core/src/invoicing/domain/ports/capabilities
 */
import type { InvoicingPort } from '../invoicing.port';

export interface DocumentNumberConsumer {
  /**
   * Discriminant flag (always `true`) marking the adapter as an OpenLinker-
   * numbered provider. Read by {@link isDocumentNumberConsumer}; a pure marker
   * interface would be invisible to a runtime guard.
   */
  readonly consumesDocumentNumber: true;
}

export function isDocumentNumberConsumer(
  adapter: InvoicingPort,
): adapter is InvoicingPort & DocumentNumberConsumer {
  return (adapter as Partial<DocumentNumberConsumer>).consumesDocumentNumber === true;
}
